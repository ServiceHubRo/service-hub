// SEC-03 (audit 13 Nov 2026): the source maps are never published.
//
//   node scripts/sourcemaps.mjs [outDir]      (default: dist; runs at the end of `npm run build`)
//
// `vite build` writes them without the `//# sourceMappingURL` line (sourcemap: 'hidden'). When the
// build has a Sentry token (Netlify env vars SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT) and a
// release (Netlify's COMMIT_REF, the same one the app sends with every error report), each script
// and its map are uploaded to that release, so Sentry still shows the exact line. Then every `.map`
// file is deleted from the output, uploaded or not. An upload that fails never fails the build.
import { readdir, readFile, rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Every file under `dir`, as paths relative to it with forward slashes. */
export async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(relative(dir, join(entry.parentPath ?? entry.path, entry.name)).split(sep).join('/'));
  }
  return out.sort();
}

/** The scripts that have a map next to them: [script, map] pairs. */
export function mappedScripts(files) {
  const set = new Set(files);
  return files.filter((f) => f.endsWith('.js') && set.has(`${f}.map`)).map((f) => [f, `${f}.map`]);
}

/**
 * The Sentry API for the organization: the address in SENTRY_URL, else the data region of the DSN
 * (an EU organization reports to `….ingest.de.sentry.io` and is served by de.sentry.io).
 */
export function sentryApi(env) {
  if (env.SENTRY_URL) return env.SENTRY_URL.replace(/\/+$/, '');
  let host = '';
  try {
    host = new URL(env.VITE_SENTRY_DSN ?? '').host;
  } catch {
    // no DSN: the default region
  }
  const region = /\.ingest\.([a-z]{2})\.sentry\.io$/.exec(host)?.[1];
  return region ? `https://${region}.sentry.io` : 'https://sentry.io';
}

/** What an upload needs, or null when this build has no token or no release. */
export function uploadConfig(env) {
  const token = env.SENTRY_AUTH_TOKEN?.trim();
  const org = env.SENTRY_ORG?.trim();
  const project = env.SENTRY_PROJECT?.trim();
  const release = env.COMMIT_REF?.trim();
  if (!token || !org || !project || !release) return null;
  return { token, org, project, release, api: sentryApi(env) };
}

/**
 * Uploads every script and its map to the release (Sentry's release files: `~/` matches any host).
 * `read(path)` answers a file's bytes, `path` relative to the output folder.
 */
export async function upload(pairs, cfg, read, fetchImpl = fetch) {
  const base = `${cfg.api}/api/0/organizations/${encodeURIComponent(cfg.org)}/releases`;
  const auth = { Authorization: `Bearer ${cfg.token}` };
  const created = await fetchImpl(`${base}/`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: cfg.release, projects: [cfg.project] }),
  });
  if (!created.ok && created.status !== 208) throw new Error(`release ${created.status}`);

  const files = pairs.flatMap(([script, map]) => [
    { path: script, name: `~/${script}`, header: `Sourcemap:${map.split('/').pop()}` },
    { path: map, name: `~/${map}` },
  ]);
  let failed = 0;
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const form = new FormData();
      form.append('name', f.name);
      if (f.header) form.append('header', f.header);
      form.append('file', new Blob([await read(f.path)]), f.path.split('/').pop());
      const res = await fetchImpl(`${base}/${encodeURIComponent(cfg.release)}/files/`, { method: 'POST', headers: auth, body: form });
      // 409: already uploaded for this release (a rebuild of the same commit).
      if (!res.ok && res.status !== 409) failed += 1;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { uploaded: files.length - failed, failed };
}

const say = (line) => process.stdout.write(`sourcemaps: ${line}\n`);

/** The output folder on disk; the tests pass their own. */
export function diskIo(outDir) {
  return {
    list: () => listFiles(outDir),
    read: (path) => readFile(join(outDir, path)),
    remove: (path) => rm(join(outDir, path)),
  };
}

export async function main(io = diskIo(resolve(process.argv[2] ?? 'dist')), env = process.env, log = say) {
  const files = await io.list();
  const maps = files.filter((f) => f.endsWith('.map'));
  const cfg = uploadConfig(env);
  if (cfg && maps.length > 0) {
    try {
      const { uploaded, failed } = await upload(mappedScripts(files), cfg, io.read);
      log(`${uploaded} files uploaded to Sentry release ${cfg.release}${failed ? `, ${failed} failed` : ''}`);
    } catch (e) {
      log(`upload to Sentry skipped (${e instanceof Error ? e.message : String(e)})`);
    }
  } else if (maps.length > 0) {
    log('no Sentry token for this build, maps not uploaded');
  }
  await Promise.all(maps.map((f) => io.remove(f)));
  log(`${maps.length} map files removed`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
