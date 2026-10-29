// job-document — the quote, the final quote or the intake sheet of a booking as a PDF (T50), for
// the booking's client, a member of its shop, or an admin after the second sign-in step.
//
// job_document_data checks who is asking and answers what the document prints; the PDF is drawn
// here and answered directly (nothing is stored: a sent quote, a finished job and a confirmed
// sheet no longer change, so the same request gives the same document). The intake photos are
// read from the private `intake-photos` bucket with the service role, after that check.
// Body: { booking_id, kind: "quote" | "final" | "intake", lang: "ro" | "en" }. Answers the PDF, or
// { error: code }.
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import { PDFDocument, rgb } from 'npm:pdf-lib@1.17.1';
import { AdminError, adminApi, tokenAal } from '../_shared/admin.ts';
import { bearerToken, corsHeaders, json } from '../_shared/http.ts';
import { jobDocFileName, type JobDocData, type JobDocKind } from '../_shared/jobDoc.ts';
import { renderJobPdf, type DocPhoto } from '../_shared/jobPdf.ts';
import { reportError } from '../_shared/monitor.ts';
import type { PdfLib } from '../_shared/reportPdf.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: readonly JobDocKind[] = ['quote', 'final', 'intake'];
const PHOTOS_BUCKET = 'intake-photos';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const api = adminApi();
    const token = bearerToken(req);
    const user = await api.userFromToken(token);
    if (!user) return json({ error: 'not_signed_in' }, 401);
    const body = (await req.json().catch(() => ({}))) as { booking_id?: unknown; kind?: unknown; lang?: unknown };
    const id = typeof body.booking_id === 'string' && UUID.test(body.booking_id) ? body.booking_id : null;
    const kind = KINDS.find((k) => k === body.kind) ?? null;
    const lang = body.lang === 'en' ? 'en' : 'ro';
    if (!id || !kind) return json({ error: 'not_found' }, 404);

    let data: JobDocData;
    try {
      data = (await api.rpc('job_document_data', {
        p_user_id: user.id,
        p_booking_id: id,
        p_kind: kind,
        p_aal: tokenAal(token),
      })) as JobDocData;
    } catch (e) {
      if (e instanceof AdminError && (e.message === 'not_found' || e.message === 'not_ready')) {
        return json({ error: e.message }, e.message === 'not_found' ? 404 : 409);
      }
      throw e;
    }

    const photos: DocPhoto[] = [];
    if (kind === 'intake') {
      for (const path of data.intake?.photos ?? []) {
        const type = /\.png$/i.test(path) ? 'png' : /\.jpe?g$/i.test(path) ? 'jpg' : null;
        if (!type) continue;
        const bytes = await api.download(PHOTOS_BUCKET, path).catch(() => null);
        if (bytes) photos.push({ bytes, type });
      }
    }

    const lib = { PDFDocument, rgb, fontkit } as unknown as PdfLib;
    const pdf = await renderJobPdf(lib, data, lang, photos);
    return new Response(pdf, {
      headers: {
        ...corsHeaders,
        'Access-Control-Expose-Headers': 'Content-Disposition',
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${jobDocFileName(lang, data)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    await reportError('job-document', e);
    return json({ error: 'unknown' }, 500);
  }
});
