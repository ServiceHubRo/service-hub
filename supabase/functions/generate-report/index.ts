// generate-report — makes the PDF of a paid report again (ARCHITECTURE §11, §13).
//
// The webhook makes it right after the payment; if that failed (the report stays "paid" without
// a file), the client's "Încearcă din nou" in Rapoartele mele calls this. Only the report's
// owner (or admin), only a paid report; a generated one is simply answered.
// Answers { status } or { error: code }.
import { AdminError, adminApi } from '../_shared/admin.ts';
import { appUrlFromEnv } from '../_shared/env.ts';
import { bearerToken, corsHeaders, json } from '../_shared/http.ts';
import { generateReport, reportRow } from '../_shared/reportGenerate.ts';

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

    try {
      await api.rpc('history_report_for', { p_user_id: user.id, p_report_id: id });
    } catch (e) {
      if (e instanceof AdminError && (e.message === 'not_found' || e.message === 'report_void')) {
        return json({ error: e.message }, 404);
      }
      throw e;
    }
    const row = await reportRow(api, id);
    if (!row) return json({ error: 'not_found' }, 404);
    if (row.status === 'pending_payment') return json({ error: 'not_paid' }, 409);
    if (row.status === 'paid') await generateReport(api, row, appUrlFromEnv());
    return json({ status: (await reportRow(api, id))?.status ?? row.status });
  } catch (e) {
    console.error('generate-report failed', e instanceof Error ? e.message : e);
    return json({ error: 'unknown' }, 500);
  }
});
