import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { emailForEvent } from '../../supabase/functions/_shared/emails';
import {
  reportDataFromRow,
  reportDay,
  reportFileName as serverFileName,
  reportKm,
  reportMoment,
  reportPeriod,
  reportText,
  REPORT_TEXT,
  verifyAddress,
  type ReportData,
} from '../../supabase/functions/_shared/report';
import { printable, renderReportPdf, wrapText, type PdfFont, type PdfLib } from '../../supabase/functions/_shared/reportPdf';
import { renderNotification } from '../../supabase/functions/_shared/templates';
import { vehicleKey } from '../../src/lib/history';
import { formatPeriod, hiddenFrom, normalizeReportCode, reportCandidates, reportFileName } from '../../src/lib/report';

const lib = { PDFDocument, rgb, fontkit } as unknown as PdfLib;

function data(overrides: Partial<ReportData> = {}): ReportData {
  const job = {
    date: '2026-08-12',
    shop_name: 'Rapid Service',
    shop_city: 'Brașov',
    service_ro: 'Schimb ulei + filtru ulei',
    service_en: 'Oil and filter change',
    items: ['Ulei 5W30 5L', 'Filtru ulei', 'Manoperă'],
    work: 'Schimb ulei și filtru 🔧',
    odometer: 105400,
    cost: 340,
  };
  return {
    code: 'SH-2026-000147',
    lang: 'ro',
    generatedAt: '2026-09-16T09:40:00Z',
    car: { make: 'Volkswagen', model: 'Golf 7', year: 2016, plate: 'BV 12 ABC', vin: 'WVWZZZAUZGW123456' },
    jobs: [job, { ...job, date: '2025-09-21', odometer: 81900, cost: 180 }],
    total: 520,
    periodFrom: '2025-09-21',
    periodTo: '2026-08-12',
    latestOdometer: 105400,
    odometerOutOfOrder: false,
    verifyAt: 'service-hub.ro/verifica',
    ...overrides,
  };
}

describe('report texts and formats', () => {
  it('formats days, times, periods and kilometers in both languages, in Bucharest', () => {
    expect(reportDay('ro', '2026-08-12')).toBe('12.08.2026');
    expect(reportDay('en', '2026-08-12')).toBe('08/12/2026');
    // 21:30 UTC is already the next day in Bucharest.
    expect(reportMoment('ro', '2026-09-16T21:30:00Z')).toEqual({ date: '17.09.2026', time: '00:30' });
    expect(reportPeriod('ro', '2025-09-21', '2026-08-12')).toBe('sep 2025 – aug 2026');
    expect(reportPeriod('en', '2026-08-01', '2026-08-12')).toBe('Aug 2026');
    expect(reportKm('ro', 105400)).toBe('105.400');
    expect(reportKm('en', 105400)).toBe('105,400');
  });

  it('has the same texts and placeholders in Romanian and US English', () => {
    const keys = Object.keys(REPORT_TEXT.ro).sort();
    expect(Object.keys(REPORT_TEXT.en).sort()).toEqual(keys);
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of keys) {
      const key = k as keyof (typeof REPORT_TEXT)['ro'];
      expect(holes(REPORT_TEXT.en[key]), key).toEqual(holes(REPORT_TEXT.ro[key]));
    }
    expect(reportText('ro', 'page', { n: 1, total: 2 })).toBe('Pagina 1 din 2');
    expect(JSON.stringify(REPORT_TEXT.en)).not.toMatch(/cancelled|tyre|colour|licence/i);
  });

  it('points buyers to the app address and names the file alike on both sides', () => {
    expect(verifyAddress('https://service-hub.ro')).toBe('service-hub.ro/verifica');
    expect(verifyAddress('https://service-hub-app.netlify.app')).toBe('service-hub-app.netlify.app/verifica');
    expect(reportFileName('ro', 'SH-2026-000001')).toBe(serverFileName('ro', 'SH-2026-000001'));
    expect(reportFileName('en', 'SH-2026-000001')).toBe('report-SH-2026-000001.pdf');
  });

  it('reads a history_reports row', () => {
    const d = reportDataFromRow(
      {
        code: 'SH-2026-000002',
        lang: 'en',
        car_snapshot: { make: 'Dacia' },
        jobs: [{ date: '2026-01-02', items: ['A', 3], cost: '120.50', odometer: null }],
        total_amount: '120.50',
        odometer_out_of_order: true,
      },
      'x/verifica',
    );
    expect(d.lang).toBe('en');
    expect(d.jobs[0]).toMatchObject({ items: ['A'], cost: 120.5, odometer: null });
    expect(d.total).toBe(120.5);
    expect(d.odometerOutOfOrder).toBe(true);
  });
});

describe('the PDF', () => {
  it('is a real A4 PDF with the fonts embedded, the code and the car', async () => {
    const bytes = await renderReportPdf(lib, data());
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
    expect(Math.round(w)).toBe(595);
    expect(Math.round(h)).toBe(842);
    expect(doc.getTitle()).toContain('SH-2026-000147');
    expect(doc.getTitle()).toContain('Volkswagen Golf 7');
  });

  it('keeps a usual history on one page, and never leaves the closing block alone on a page', async () => {
    const pages = async (n: number) => {
      const d = data();
      d.jobs = Array.from({ length: n }, () => d.jobs[0]!);
      return (await PDFDocument.load(await renderReportPdf(lib, d))).getPageCount();
    };
    // Five jobs, the total, the figures and the notice fit on the first page.
    expect(await pages(5)).toBe(1);
    // More jobs: pages are added one at a time, never an extra page for the closing block alone
    // (it moves together with the last job, so one more job never costs more than one page).
    let before = 1;
    for (let n = 6; n <= 24; n++) {
      const now = await pages(n);
      expect(now - before, `${n} jobs`).toBeGreaterThanOrEqual(0);
      expect(now - before, `${n} jobs`).toBeLessThanOrEqual(1);
      before = now;
    }
    expect(before).toBeGreaterThan(1);
  });

  it('adds pages for long histories and prints English', async () => {
    const many = data({ lang: 'en', odometerOutOfOrder: true });
    many.jobs = Array.from({ length: 30 }, () => many.jobs[0]!);
    const doc = await PDFDocument.load(await renderReportPdf(lib, many));
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getSubject()).toContain('Service history report');
  });

  it('keeps Romanian letters and leaves out what the fonts cannot print', async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const { SANS_REGULAR } = await import('../../supabase/functions/_shared/reportFonts');
    const font = (await doc.embedFont(Uint8Array.from(atob(SANS_REGULAR), (c) => c.charCodeAt(0)))) as unknown as PdfFont;
    const charset = new Set(font.getCharacterSet());
    for (const ch of 'șțăâîȘȚĂÂÎşţ–·„”€') expect(charset.has(ch.codePointAt(0)!), ch).toBe(true);
    expect(printable('Frâne 🔧  față\nși spate', charset)).toBe('Frâne față și spate');
    // s + combining comma below becomes ș.
    expect(printable('ș', charset)).toBe('ș');
    const lines = wrapText('Plăcuțe frână față · Discuri frână față · Manoperă', font, 9, 120);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 9)).toBeLessThanOrEqual(120);
    expect(wrapText('WVWZZZAUZGW123456WVWZZZAUZGW123456', font, 9, 60).length).toBeGreaterThan(1);
  });
});

describe('preview and Rapoartele mele', () => {
  it('hides the last two jobs, never the only one', () => {
    expect(hiddenFrom(1)).toBe(1);
    expect(hiddenFrom(2)).toBe(1);
    expect(hiddenFrom(3)).toBe(1);
    expect(hiddenFrom(5)).toBe(3);
  });

  it('accepts a code however the buyer types it', () => {
    expect(normalizeReportCode(' sh-2026-000147 ')).toBe('SH-2026-000147');
    expect(normalizeReportCode('SH 2026 000147')).toBe('SH-2026-000147');
    expect(normalizeReportCode('SH2026000147')).toBe('SH-2026-000147');
    expect(normalizeReportCode('SH-2026-14')).toBeNull();
    expect(normalizeReportCode('')).toBeNull();
  });

  it('formats the period for the screens', () => {
    expect(formatPeriod('en', '2025-09-21', '2026-08-12')).toBe('Sep 2025 – Aug 2026');
    expect(formatPeriod('ro', '2026-08-01', '2026-08-30')).toMatch(/^aug\.? 2026$/);
    expect(formatPeriod('ro', null, null)).toBe('');
  });

  it('offers a new report only for cars with finished jobs, the garage first', () => {
    const job = (id: string, plate: string, status: 'done' | 'cancelled' = 'done') => ({
      id,
      status,
      car_snapshot: { make: 'Dacia', model: 'Logan', plate },
      date: '2026-05-01',
      slot: '10:00',
      done_at: status === 'done' ? '2026-05-01T08:00:00Z' : null,
      cost: 100,
    });
    const cars = [
      { id: 'c1', make: 'VW', model: 'Golf', plate: 'BV 12 ABC' },
      { id: 'c2', make: 'Dacia', model: 'Logan', plate: 'BV 99 XYZ' },
    ];
    const list = reportCandidates(cars, [job('b1', 'bv12abc'), job('b2', 'BV 99 XYZ', 'cancelled'), job('b3', 'CJ 01 AAA')]);
    expect(list.map((c) => (c.kind === 'car' ? c.car.id : c.bookingId))).toEqual(['c1', 'b3']);
  });

  it('matches cars the way the database does (vehicle_key in the T15 migration)', () => {
    expect(vehicleKey({ plate: 'bv-12 abc' })).toBe('plate:BV12ABC');
    expect(vehicleKey({ plate: '  ', make: ' Dacia ', model: 'Logan  MCV', year: 2015 })).toBe('car:dacia|logan mcv|2015');
    expect(vehicleKey({ make: 'Dacia', model: 'Logan' })).toBe('car:dacia|logan|');
  });
});

describe('report_ready', () => {
  const event = {
    event: 'report_ready',
    role: 'client',
    params: { report_id: 'r1', code: 'SH-2026-000147', make: 'Volkswagen', model: 'Golf 7', plate: 'BV 12 ABC' },
    booking_id: null,
  };

  it('tells the client by push, in their language, and opens Rapoartele mele', () => {
    expect(renderNotification({ ...event, lang: 'ro' })).toMatchObject({
      title: 'Raportul e gata',
      body: 'Raportul de istoric pentru Volkswagen Golf 7 (BV 12 ABC) e gata de descărcat. Cod: SH-2026-000147.',
      url: '/c/cont/rapoarte',
      tag: 'report-r1',
    });
    expect(renderNotification({ ...event, lang: 'en' })?.title).toBe('Your report is ready');
  });

  it('and by email, with the code and the link', () => {
    const mail = emailForEvent({ ...event, lang: 'en' }, 'https://service-hub.ro')!;
    expect(mail.subject).toBe('Your history report is ready: SH-2026-000147');
    expect(mail.html).toContain('https://service-hub.ro/c/cont/rapoarte');
    expect(emailForEvent({ ...event, lang: 'ro' }, 'https://x')!.text).toContain('Rapoartele mele');
  });
});
