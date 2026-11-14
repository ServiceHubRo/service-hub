// support-files — the files of support requests (A3b).
//
// Three calls, all POST:
// · A file (multipart/form-data, field `file`), from the app: the caller's token is checked with the
//   Auth server; the file's real type and soundness are checked from its bytes and a clean copy is
//   made (_shared/supportFiles.ts: every personal metadata of a photo removed, the orientation kept;
//   active or encrypted PDFs refused). support_file_begin checks who may upload and the limits,
//   then the copy is stored (private bucket, `<user>/<random>`) and support_file_register records it
//   as "not sent". The same for the author and the team. Answers { id, name, mime, size }.
// · { action: 'open', file_id }, from the app: support_file_open checks the caller may see it and
//   writes the audit log; answers { url, name, mime } — a signed link valid 60 seconds, the path to
//   append to the project's address; a PDF is downloaded, never shown in the browser.
// · { action: 'cleanup' } with the dispatcher's x-dispatch-token, once a day from the database:
//   rows due are deleted (not sent for 24 hours, requests closed 90 days ago), then every queued path
//   and every stray object older than 24 hours leaves Storage.
// Errors answer { error: code } with the code the app translates.
import { AdminError, adminApi, tokenAal, tokenSession } from '../_shared/admin.ts';
import { bearerToken, corsHeaders, json, serve } from '../_shared/http.ts';
import { reportError } from '../_shared/monitor.ts';
import { checkFile, MAX_FILE_BYTES } from '../_shared/supportFiles.ts';

const BUCKET = 'support-files';
const LINK_SECONDS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Refusals of the database the app translates; anything else is `unknown`. */
const KNOWN = new Set([
  'not_signed_in',
  'not_allowed',
  'mfa_required',
  'account_suspended',
  'too_many_files',
  'limit_support_uploads',
  'file_invalid',
  'file_not_found',
]);

type Api = ReturnType<typeof adminApi>;

function refusal(e: unknown): Response | null {
  if (e instanceof AdminError && KNOWN.has(e.message)) {
    const status = e.message === 'not_signed_in' ? 401 : e.message === 'file_not_found' ? 404 : e.message.startsWith('limit') || e.message === 'too_many_files' ? 429 : 403;
    return json({ error: e.message }, status);
  }
  return null;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function upload(req: Request, api: Api, user: string, aal: string, session: string | null): Promise<Response> {
  // The body is read only when it can be a single file of at most 5 MB (with the form's own bytes).
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_FILE_BYTES + 64 * 1024) return json({ error: 'file_too_large' }, 413);
  let file: File | null = null;
  try {
    const form = await req.formData();
    const value = form.get('file');
    file = value instanceof File ? value : null;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!file) return json({ error: 'bad_request' }, 400);
  if (file.size > MAX_FILE_BYTES) return json({ error: 'file_too_large' }, 413);

  const checked = await checkFile(new Uint8Array(await file.arrayBuffer()), file.name);
  if (!checked.ok) {
    const code = checked.reason === 'too_large' ? 'file_too_large' : checked.reason === 'empty' ? 'file_corrupt' : `file_${checked.reason}`;
    return json({ error: code }, checked.reason === 'too_large' ? 413 : 422);
  }

  try {
    await api.rpc('support_file_begin', { p_user: user, p_aal: aal, p_session: session });
  } catch (e) {
    const r = refusal(e);
    if (r) return r;
    throw e;
  }
  const path = `${user}/${crypto.randomUUID()}`;
  await api.upload(BUCKET, path, checked.bytes, checked.mime);
  try {
    const row = await api.rpc('support_file_register', {
      p_user: user,
      p_aal: aal,
      p_session: session,
      p_path: path,
      p_mime: checked.mime,
      p_size: checked.bytes.length,
      p_name: checked.name,
      p_sha256: await sha256(checked.bytes),
    });
    return json(row);
  } catch (e) {
    // Not recorded: the stored copy goes at once (the daily cleanup would find it otherwise).
    await api.remove(BUCKET, [path]).catch(() => undefined);
    const r = refusal(e);
    if (r) return r;
    throw e;
  }
}

async function open(api: Api, user: string, aal: string, session: string | null, fileId: unknown): Promise<Response> {
  if (typeof fileId !== 'string' || !UUID.test(fileId)) return json({ error: 'bad_request' }, 400);
  let file: { path: string; mime: string; name: string };
  try {
    file = (await api.rpc('support_file_open', { p_user: user, p_aal: aal, p_session: session, p_file: fileId })) as typeof file;
  } catch (e) {
    const r = refusal(e);
    if (r) return r;
    throw e;
  }
  const url = await api.signedPath(BUCKET, file.path, LINK_SECONDS, file.mime === 'application/pdf' ? file.name : undefined);
  return json({ url, name: file.name, mime: file.mime });
}

async function cleanup(api: Api): Promise<Response> {
  const collected = (await api.rpc('support_files_collect', {})) as number;
  let removed = 0;
  for (let round = 0; round < 20; round++) {
    const paths = ((await api.rpc('support_file_deletions_next', { p_limit: 500 })) ?? []) as string[];
    if (paths.length === 0) break;
    await api.remove(BUCKET, paths);
    removed += (await api.rpc('support_file_deletions_done', { p_paths: paths })) as number;
  }
  const stray = ((await api.rpc('support_files_stray', { p_limit: 500 })) ?? []) as string[];
  if (stray.length) await api.remove(BUCKET, stray);
  return json({ collected, removed, stray: stray.length });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const api = adminApi();

    const dispatch = req.headers.get('x-dispatch-token');
    if (dispatch) {
      if (!(await api.rpc('is_dispatch_token', { p_token: dispatch }))) return json({ error: 'not_allowed' }, 403);
      return await cleanup(api);
    }

    const token = bearerToken(req);
    const caller = await api.userFromToken(token);
    if (!caller) return json({ error: 'not_signed_in' }, 401);
    const aal = tokenAal(token);
    const session = tokenSession(token);

    if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) return await upload(req, api, caller.id, aal, session);

    let body: { action?: unknown; file_id?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: 'bad_request' }, 400);
    }
    if (body.action === 'open') return await open(api, caller.id, aal, session, body.file_id);
    return json({ error: 'bad_request' }, 400);
  } catch (e) {
    await reportError('support-files', e);
    return json({ error: 'unknown' }, 500);
  }
});
