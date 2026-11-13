// fleet-files — the files of a company's vehicles (A6, M4): receipts (photo or PDF) and the photos of a
// report. The only way to store one: the bucket's insert rule asks for a ticket only this function
// writes.
//
// POST multipart/form-data with `file`, `company`, `vehicle` and, for a report's photo, `issue`:
// 1. The caller's token is checked with the Auth server.
// 2. The file's real type and soundness come from its bytes, never its name or the browser's type
//    (_shared/supportFiles.ts): a PNG that is not one, a broken file, an encrypted PDF or one with
//    JavaScript or other active content is refused; a photo is rewritten without its metadata (GPS,
//    camera, owner, dates), keeping only the orientation and the color profile. At most 5 MB.
// 3. fleet_file_begin, as the person: may it write for that vehicle (or report), not suspended, at most
//    60 files an hour per person, 6 photos a report, 500 MB a company. Answers the path.
// 4. fleet_file_ticket (service role): that path, for that person, 2 minutes.
// 5. The clean copy is stored with the person's own token (the file is theirs, as before A6), then the
//    ticket goes. Answers { path, mime, size }.
// A refusal worth knowing (a dangerous file, a vehicle of another company, a limit) is recorded in the
// security log, with codes and ids only. Errors answer { error: code } with the code the app translates.
import { AdminError, adminApi, userApi } from '../_shared/admin.ts';
import { FLEET_KNOWN, kindAllowed, parseTarget, readCapped, refusalStatus, rejectionCode, securityKind } from '../_shared/fleetFiles.ts';
import { bearerToken, corsHeaders, json, serve } from '../_shared/http.ts';
import { reportError } from '../_shared/monitor.ts';
import { checkFile, MAX_FILE_BYTES } from '../_shared/supportFiles.ts';

const BUCKET = 'fleet-files';

type Api = ReturnType<typeof adminApi>;

/** A single file of at most 5 MB, with room for the form's own bytes. */
const BODY_LIMIT = MAX_FILE_BYTES + 64 * 1024;


/** Records the refusal in the security log when it matters; never fails the answer. */
async function note(api: Api, user: string, code: string, detail: Record<string, unknown>): Promise<void> {
  const s = securityKind(code);
  if (!s) return;
  await api
    .rpc('security_report', { p_user: user, p_kind: s.kind, p_severity: s.severity, p_detail: { code, ...detail } })
    .catch((e) => reportError('fleet-files', e));
}

async function refuse(api: Api, user: string, code: string, detail: Record<string, unknown> = {}): Promise<Response> {
  await note(api, user, code, detail);
  return json({ error: code }, refusalStatus(code));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const api = adminApi();
    const token = bearerToken(req);
    const caller = await api.userFromToken(token);
    if (!caller || !token) return json({ error: 'not_signed_in' }, 401);
    if (!(req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) return json({ error: 'bad_request' }, 400);

    // The body is read only up to a single file of 5 MB plus the form's own bytes, whatever the
    // request declares: past that the transfer is cut and the answer is 413 at once.
    const contentType = req.headers.get('content-type') ?? '';
    const declared = Number(req.headers.get('content-length') ?? '0');
    if (declared > BODY_LIMIT) {
      await req.body?.cancel().catch(() => undefined);
      return await refuse(api, caller.id, 'file_too_large');
    }
    const body = await readCapped(req, BODY_LIMIT);
    if (!body) return await refuse(api, caller.id, 'file_too_large');
    let form: FormData;
    try {
      form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
    } catch {
      return json({ error: 'bad_request' }, 400);
    }
    const file = form.get('file');
    const target = parseTarget({ company: form.get('company'), vehicle: form.get('vehicle'), issue: form.get('issue') });
    if (!(file instanceof File) || !target) return json({ error: 'bad_request' }, 400);
    if (file.size > MAX_FILE_BYTES) return await refuse(api, caller.id, 'file_too_large');

    const checked = await checkFile(new Uint8Array(await file.arrayBuffer()), file.name);
    if (!checked.ok) return await refuse(api, caller.id, rejectionCode(checked), { company: target.company });
    if (!kindAllowed(checked.kind, target)) return await refuse(api, caller.id, 'file_type', { company: target.company });

    const person = userApi(token);
    let path: string;
    try {
      const begun = (await person.rpc('fleet_file_begin', {
        p_company: target.company,
        p_vehicle: target.vehicle,
        p_issue: target.issue,
        p_mime: checked.mime,
        p_size: checked.bytes.length,
      })) as { path?: unknown };
      if (typeof begun?.path !== 'string') throw new Error('fleet_file_begin: no path');
      path = begun.path;
    } catch (e) {
      if (e instanceof AdminError && FLEET_KNOWN.has(e.message)) {
        return await refuse(api, caller.id, e.message, { company: target.company, vehicle: target.vehicle });
      }
      throw e;
    }

    await api.rpc('fleet_file_ticket', { p_user: caller.id, p_path: path });
    try {
      await person.upload(BUCKET, path, checked.bytes, checked.mime);
    } finally {
      await api.rpc('fleet_file_ticket_done', { p_path: path }).catch(() => undefined);
    }
    return json({ path, mime: checked.mime, size: checked.bytes.length });
  } catch (e) {
    await reportError('fleet-files', e);
    return json({ error: 'unknown' }, 500);
  }
});
