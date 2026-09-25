// Makes the PDF of a paid history report and stores it (Deno only: pdf-lib comes from npm).
// Used by stripe-webhook right after the payment, and by generate-report when the client taps
// "Încearcă din nou" on a report still waiting for its PDF.
//
// The row already holds everything the PDF prints (history_reports.jobs, taken at payment), so
// making it again gives the same document. The file goes to the private `reports` bucket;
// finish_history_report then marks the report generated and tells the client (once).
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import { PDFDocument, rgb } from 'npm:pdf-lib@1.17.1';
import type { adminApi } from './admin.ts';
import { reportDataFromRow, reportPath, verifyAddress } from './report.ts';
import { renderReportPdf, type PdfLib } from './reportPdf.ts';

type Api = ReturnType<typeof adminApi>;

export const REPORTS_BUCKET = 'reports';

/** The report row (service role), or null. */
export async function reportRow(api: Api, id: string): Promise<Record<string, unknown> | null> {
  const rows = await api.select(`history_reports?id=eq.${encodeURIComponent(id)}&select=*`);
  return rows[0] ?? null;
}

/** Generates and stores the PDF of a `paid` report; true when this call finished it. */
export async function generateReport(api: Api, row: Record<string, unknown>, appUrl: string): Promise<boolean> {
  if (row.status !== 'paid') return false;
  const generatedAt = new Date().toISOString();
  const data = reportDataFromRow({ ...row, generated_at: generatedAt }, verifyAddress(appUrl));
  const lib = { PDFDocument, rgb, fontkit } as unknown as PdfLib;
  const bytes = await renderReportPdf(lib, data);
  const path = reportPath(typeof row.client_id === 'string' ? row.client_id : null, String(row.id), data.code);
  await api.upload(REPORTS_BUCKET, path, bytes, 'application/pdf');
  return (await api.rpc('finish_history_report', {
    p_report_id: row.id,
    p_path: path,
    p_generated_at: generatedAt,
  })) === true;
}
