// history-document — the shop's repair history (Istoric) as a PDF, in the quote's format
// (SH_to_fix, 26 Nov 2026), for the shop's owner or a colleague.
//
// The list is read again as the person (`list_shop_history`, `list_imported_jobs` with their own
// token), so the PDF holds only what they may read; the screen sends which rows it shows (its
// filters and search) and in what order, and how it names the filters. The shop's header is the
// quote's (`quote_issuer`). Nothing is stored; at most 30 documents an hour per person, shared with
// the quotes (`document_limit`).
// Body: { ids: string[], lang: "ro" | "en", filters?: string }. Answers the PDF, or { error: code }.
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import { PDFDocument, rgb } from 'npm:pdf-lib@1.17.1';
import { AdminError, adminApi, userApi } from '../_shared/admin.ts';
import { bearerToken, corsHeaders, json, serve } from '../_shared/http.ts';
import { historyDocRows, renderHistoryPdf, type HistoryDocShop, type RawHistoryBooking, type RawImportedJob } from '../_shared/historyPdf.ts';
import { reportError } from '../_shared/monitor.ts';
import type { PdfLib } from '../_shared/reportPdf.ts';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROWS = 1000;
const IMPORTED_PAGE = 100;
const IMPORTED_PAGES_MAX = 20;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const api = adminApi();
    const token = bearerToken(req);
    const user = await api.userFromToken(token);
    if (!user || !token) return json({ error: 'not_signed_in' }, 401);
    const body = (await req.json().catch(() => ({}))) as { ids?: unknown; lang?: unknown; filters?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && ID.test(x)).slice(0, MAX_ROWS) : [];
    const lang = body.lang === 'en' ? 'en' : 'ro';
    const filters = typeof body.filters === 'string' && body.filters.trim() ? body.filters.trim().slice(0, 300) : null;

    try {
      await api.rpc('document_limit', { p_user: user.id, p_kind: 'job_document' });
    } catch (e) {
      if (e instanceof AdminError && e.message === 'limit_documents') {
        await api
          .rpc('security_report', { p_user: user.id, p_kind: 'limit_documents', p_severity: 'info', p_detail: { kind: 'history_document' } })
          .catch(() => undefined);
        return json({ error: 'limit_documents' }, 429);
      }
      throw e;
    }

    // As the person: a shop member reads their own shop's history, anyone else reads nothing.
    const me = userApi(token);
    let history: { shop?: { id: string } | null; bookings?: RawHistoryBooking[]; imported?: RawImportedJob[] } | null;
    try {
      history = (await me.rpc('list_shop_history', {})) as typeof history;
    } catch (e) {
      if (e instanceof AdminError && e.status < 500) return json({ error: 'not_found' }, 404);
      throw e;
    }
    const shopId = history?.shop?.id;
    if (!shopId) return json({ error: 'not_found' }, 404);

    // The imported jobs the list shows beyond the first page, page by page, as the person.
    const imported = [...(history?.imported ?? [])];
    const wanted = new Set(ids);
    const have = () => imported.filter((j) => wanted.has(j.id)).length;
    const bookingIds = new Set((history?.bookings ?? []).map((b) => b.id));
    const importedWanted = ids.filter((id) => !bookingIds.has(id)).length;
    for (let n = 0; n < IMPORTED_PAGES_MAX && have() < importedWanted; n++) {
      const last = imported[imported.length - 1];
      const page = (await me.rpc('list_imported_jobs', {
        p_before_day: last?.day ?? null,
        p_before_id: last?.id ?? null,
        p_limit: IMPORTED_PAGE,
      })) as { jobs?: RawImportedJob[] } | null;
      const jobs = page?.jobs ?? [];
      if (jobs.length === 0) break;
      imported.push(...jobs.slice(0, IMPORTED_PAGE));
      if (jobs.length <= IMPORTED_PAGE) break; // the function answers one more when there is a next page
    }

    const shop = ((await api.rpc('quote_issuer', { p_shop_id: shopId })) ?? {}) as HistoryDocShop;
    const [owner] = await api.select(`shops?id=eq.${shopId}&select=owner_id`);
    const rows = historyDocRows(lang, ids, history?.bookings ?? [], imported);

    const lib = { PDFDocument, rgb, fontkit } as unknown as PdfLib;
    const pdf = await renderHistoryPdf(lib, { shop, rows, owner: owner?.owner_id === user.id, filters }, lang);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(new Date());
    const name = `${lang === 'en' ? 'repair-history' : 'istoric-reparatii'}-${day}.pdf`;
    return new Response(pdf, {
      headers: {
        ...corsHeaders,
        'Access-Control-Expose-Headers': 'Content-Disposition',
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    await reportError('history-document', e);
    return json({ error: 'unknown' }, 500);
  }
});
