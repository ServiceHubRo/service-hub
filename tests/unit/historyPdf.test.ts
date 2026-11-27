import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  historyDocRows,
  historyDocText,
  historyDocTotals,
  renderHistoryPdf,
  type HistoryDocData,
  type RawHistoryBooking,
  type RawImportedJob,
} from '../../supabase/functions/_shared/historyPdf';
import type { PdfLib } from '../../supabase/functions/_shared/reportPdf';

// SH_to_fix (26 Nov 2026): the shop's history as a PDF in the quote's format.
const lib = { PDFDocument, rgb, fontkit } as unknown as PdfLib;

const booking = (over: Partial<RawHistoryBooking> = {}): RawHistoryBooking => ({
  id: '00000000-0000-4000-8000-000000000001',
  ref: 'P-000001',
  status: 'done',
  ended_at: '2026-11-26T14:30:00Z',
  service_id: 'ulei',
  service_ro: 'Schimb ulei + filtru ulei',
  service_en: 'Oil and filter change',
  extra_services: [{ name_ro: 'Filtru aer', name_en: 'Air filter' }],
  client_name: 'Bogdan Felea',
  car_snapshot: { make: 'Skoda', model: 'Octavia', year: 2015, plate: 'BV 88 BOB' },
  odometer: 196424,
  work: 'Ulei 5W30 schimbat, filtre noi.',
  cost: '1166.00',
  ...over,
});

const imported: RawImportedJob = {
  id: '00000000-0000-4000-8000-0000000000aa',
  day: '2025-03-14',
  client_name: 'Ioana Radu',
  car_snapshot: { make: 'Dacia', model: 'Logan', plate: 'B 123 ABC' },
  odometer: null,
  work: 'Distribuție',
  cost: 900,
};

describe('history PDF', () => {
  it('prints exactly the rows the screen shows, in its order, and nothing that is not the shop’s', () => {
    const refused = booking({ id: '00000000-0000-4000-8000-000000000002', ref: 'P-000002', status: 'quote_refused', cost: 80 });
    const rows = historyDocRows('ro', [imported.id, refused.id, booking().id, '00000000-0000-4000-8000-0000000000ff'], [booking(), refused], [imported]);
    expect(rows.map((r) => r.ref)).toEqual([null, 'P-000002', 'P-000001']);
    expect(rows[2]).toMatchObject({ car: 'Skoda Octavia 2015', plate: 'BV 88 BOB', services: 'Schimb ulei + filtru ulei, Filtru aer', cost: 1166 });
    expect(historyDocRows('en', [booking().id], [booking()], [])[0]!.services).toBe('Oil and filter change, Air filter');
  });

  it('counts the finished jobs and their takings like the screen (imported jobs apart)', () => {
    const rows = historyDocRows('ro', [booking().id, imported.id], [booking()], [imported]);
    expect(historyDocTotals(rows)).toEqual({ jobs: 1, revenue: 1166 });
  });

  it('draws an A4 document with the shop’s header, in both languages, over several pages when long', async () => {
    const shop = { name: 'Auto-test', legal_name: 'AUTO TEST SRL', vat_id: 'RO123', reg_com: 'J08/1/2020', legal_address: 'Str. Lungă 1, Brașov', phone: '0740450585' };
    for (const lang of ['ro', 'en'] as const) {
      const data: HistoryDocData = { shop, rows: historyDocRows(lang, [booking().id], [booking()], []), owner: true, filters: 'Stare: Finalizate' };
      const doc = await PDFDocument.load(await renderHistoryPdf(lib, data, lang));
      expect(doc.getPageCount()).toBe(1);
      expect(doc.getTitle()).toContain(historyDocText(lang, 'title'));
      const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
      expect(Math.round(w)).toBe(595);
      expect(Math.round(h)).toBe(842);
    }
    const many = Array.from({ length: 80 }, (_, i) => booking({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, ref: `P-${i}` }));
    const long: HistoryDocData = { shop, rows: historyDocRows('ro', many.map((b) => b.id), many, []), owner: false, filters: null };
    expect((await PDFDocument.load(await renderHistoryPdf(lib, long, 'ro'))).getPageCount()).toBeGreaterThan(2);
  });

  it('an empty list still makes a document that says so', async () => {
    const doc = await PDFDocument.load(await renderHistoryPdf(lib, { shop: { name: 'Auto-test' }, rows: [], owner: true, filters: null }, 'ro'));
    expect(doc.getPageCount()).toBe(1);
  });
});
