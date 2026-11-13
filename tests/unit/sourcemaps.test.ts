import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- a plain Node script, no type declarations
import { main, mappedScripts, sentryApi, upload, uploadConfig } from '../../scripts/sourcemaps.mjs';

// SEC-03 (audit 13 Nov 2026): the source maps go to Sentry (when the build has a token) and are
// never published with the site.

/** A built site in memory: its files and the ones removed. */
function site() {
  const files = new Map<string, string>([
    ['index.html', '<html></html>'],
    ['assets/index-a1.js', 'console.info(1)'],
    ['assets/index-a1.js.map', '{"version":3}'],
    ['assets/ClientApp-b2.js', 'x'],
    ['assets/ClientApp-b2.js.map', '{"version":3}'],
    ['assets/index-c3.css', 'body{}'],
  ]);
  return {
    files,
    io: {
      list: async () => [...files.keys()].sort(),
      read: async (path: string) => new TextEncoder().encode(files.get(path) ?? ''),
      remove: async (path: string) => void files.delete(path),
    },
  };
}

const ENV = { SENTRY_AUTH_TOKEN: 't', SENTRY_ORG: 'acme', SENTRY_PROJECT: 'web', COMMIT_REF: 'abc' };

describe('source maps', () => {
  it('pairs each script with its map', () => {
    expect(mappedScripts(['assets/a.js', 'assets/a.js.map', 'assets/b.js', 'assets/c.css'])).toEqual([['assets/a.js', 'assets/a.js.map']]);
  });

  it('uploads only with a token, an organization, a project and a release', () => {
    expect(uploadConfig(ENV)).toEqual({ token: 't', org: 'acme', project: 'web', release: 'abc', api: 'https://sentry.io' });
    for (const key of Object.keys(ENV)) expect(uploadConfig({ ...ENV, [key]: '' }), key).toBeNull();
  });

  it('finds the data region from the DSN', () => {
    expect(sentryApi({ VITE_SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/2' })).toBe('https://de.sentry.io');
    expect(sentryApi({ VITE_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/2' })).toBe('https://sentry.io');
    expect(sentryApi({ SENTRY_URL: 'https://sentry.example/' })).toBe('https://sentry.example');
    expect(sentryApi({})).toBe('https://sentry.io');
  });

  it('creates the release and uploads each script with its map', async () => {
    const { io } = site();
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const body =
        init.body instanceof FormData
          ? Object.fromEntries([...init.body.entries()].filter(([k]) => k !== 'file'))
          : (JSON.parse(String(init.body)) as unknown);
      calls.push({ url, body });
      return new Response('{}', { status: 201 });
    });
    const cfg = { ...uploadConfig(ENV), api: 'https://de.sentry.io' };
    const result = await upload(mappedScripts(['assets/index-a1.js', 'assets/index-a1.js.map']), cfg, io.read, fetchImpl);
    expect(result).toEqual({ uploaded: 2, failed: 0 });
    expect(calls[0]).toEqual({ url: 'https://de.sentry.io/api/0/organizations/acme/releases/', body: { version: 'abc', projects: ['web'] } });
    expect(calls.slice(1).map((c) => c.url)).toEqual(Array(2).fill('https://de.sentry.io/api/0/organizations/acme/releases/abc/files/'));
    expect(calls.slice(1).map((c) => c.body)).toEqual(
      expect.arrayContaining([{ name: '~/assets/index-a1.js', header: 'Sourcemap:index-a1.js.map' }, { name: '~/assets/index-a1.js.map' }]),
    );
    expect(fetchImpl.mock.calls[0]![1].headers).toMatchObject({ Authorization: 'Bearer t' });
  });

  it('removes every map from the site without a token, uploading nothing', async () => {
    const { files, io } = site();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await main(io, {}, () => {});
    expect([...files.keys()].sort()).toEqual(['assets/ClientApp-b2.js', 'assets/index-a1.js', 'assets/index-c3.css', 'index.html']);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('removes the maps even when Sentry cannot be reached', async () => {
    const { files, io } = site();
    const lines: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await main(io, ENV, (line: string) => lines.push(line));
    expect(lines.some((l) => l.includes('skipped (offline)'))).toBe(true);
    expect([...files.keys()].filter((f) => f.endsWith('.map'))).toEqual([]);
    fetchSpy.mockRestore();
  });
});
