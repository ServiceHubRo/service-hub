// report-download — "Descarcă" in Rapoartele mele (ARCHITECTURE §2 Storage, §11, §13): the PDF of
// one of the caller's reports, free, as often as they like.
//
// The `reports` bucket is private and has no policies: this function checks the caller owns the
// report (history_report_for; admin may read any, a void report is refused to the client), then
// reads the file with the service role and hands it back as the answer — no link that could be
// passed on. Answers the PDF, or { error: code }.
import { AdminError, adminApi } from '../_shared/admin.ts';
import { bearerToken, corsHeaders, json } from '../_shared/http.ts';
import { reportFileName } from '../_shared/report.ts';
import { REPORTS_BUCKET } from '../_shared/reportGenerate.ts';
import { reportError } from '../_shared/monitor.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const api = adminApi();
    const user = await api.userFromToken(bearerToken(req));
    if (!user) return json({ error: 'not_signed_in' }, 401);
    const body = (await req.json().catch(() => ({}))) as { report_id?: unknown };
    const id = typeof body.report_id === 'string' && UUID.test(body.report_id) ? body.report_id : null;
    if (!id) return json({ error: 'not_found' }, 404);

    let report: { code: string; lang: string; status: string; pdf_url: string | null };
    try {
      report = (await api.rpc('history_report_for', { p_user_id: user.id, p_report_id: id })) as typeof report;
    } catch (e) {
      if (e instanceof AdminError && (e.message === 'not_found' || e.message === 'report_void')) {
        return json({ error: e.message }, 404);
      }
      throw e;
    }
    if (!report.pdf_url) return json({ error: 'not_ready' }, 409);
    const bytes = await api.download(REPORTS_BUCKET, report.pdf_url);
    if (!bytes) return json({ error: 'not_ready' }, 409);

    const name = reportFileName(report.lang === 'en' ? 'en' : 'ro', report.code);
    return new Response(bytes, {
      headers: {
        ...corsHeaders,
        'Access-Control-Expose-Headers': 'Content-Disposition',
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    await reportError('report-download', e);
    return json({ error: 'unknown' }, 500);
  }
});
