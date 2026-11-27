// The shop's repair history as a PDF (SH_to_fix, 26 Nov 2026: „în același format cu devizul și
// celelalte documente”): A4, white, dark text, the amber accent and Inter, the shop's header like
// the quote's (jobPdf.ts), the jobs in one table that repeats its head on every page, the totals,
// and the page numbers. What the table holds is exactly the list the screen shows (its filters),
// read again from the database as the person asking (history-document).
//
// pdf-lib and fontkit are handed in (`PdfLib`), so the unit tests run this file as it is.
import { docDay, docKm, docMoney, type Lang } from './jobDoc.ts';
import { INTER_BOLD, INTER_REGULAR } from './reportFonts.ts';
import { base64Bytes, clampLines, printable, wrapText, type PdfFont, type PdfLib } from './reportPdf.ts';

type Color = object;

interface PdfPage {
  drawText(text: string, options: { x: number; y: number; size: number; font: PdfFont; color: Color }): void;
  drawRectangle(options: { x: number; y: number; width: number; height: number; color?: Color }): void;
  drawLine(options: { start: { x: number; y: number }; end: { x: number; y: number }; thickness: number; color: Color }): void;
}

interface PdfDocument {
  registerFontkit(fontkit: unknown): void;
  embedFont(bytes: Uint8Array, options?: { subset?: boolean }): Promise<PdfFont>;
  addPage(size: [number, number]): PdfPage;
  getPages(): PdfPage[];
  setTitle(title: string): void;
  setAuthor(author: string): void;
  setSubject(subject: string): void;
  setCreator(creator: string): void;
  setProducer(producer: string): void;
  setLanguage(language: string): void;
  setCreationDate(date: Date): void;
  setModificationDate(date: Date): void;
  save(): Promise<Uint8Array>;
}

/** The shop as the quote prints it (`quote_issuer`). */
export interface HistoryDocShop {
  name?: string;
  street?: string;
  city?: string;
  county?: string;
  phone?: string;
  legal_name?: string;
  vat_id?: string;
  reg_com?: string;
  legal_address?: string;
}

export type HistoryDocStatus = 'done' | 'quote_refused' | 'expired' | 'cancelled' | 'no_show';

/** One job of the list, as it is printed. */
export interface HistoryDocRow {
  /** When it ended: an ISO moment, or the day (`YYYY-MM-DD`) of an imported job. */
  ended: string;
  /** The booking code; null for a job imported from another program. */
  ref: string | null;
  car: string;
  plate: string | null;
  client: string | null;
  services: string | null;
  status: HistoryDocStatus;
  work: string | null;
  odometer: number | null;
  cost: number | null;
}

export interface HistoryDocData {
  shop: HistoryDocShop;
  rows: HistoryDocRow[];
  /** The takings are the owner's (the screen's rule): a colleague's PDF has no total. */
  owner: boolean;
  /** What the list was narrowed to, as the screen names it („Stare: Finalizate · Perioadă: …”). */
  filters: string | null;
}

// ------------------------------------------------------------------ the rows, from the database

/** A booking as `list_shop_history` answers it (only what the PDF prints). */
export interface RawHistoryBooking {
  id: string;
  ref: string;
  status: string;
  ended_at: string;
  service_id?: string | null;
  service_ro: string | null;
  service_en: string | null;
  extra_services?: { name_ro: string | null; name_en: string | null }[] | null;
  client_name: string | null;
  car_snapshot: { make?: string | null; model?: string | null; year?: number | null; plate?: string | null } | null;
  odometer: number | null;
  work: string | null;
  cost: number | string | null;
}

/** An imported job as `list_shop_history` / `list_imported_jobs` answer it. */
export interface RawImportedJob {
  id: string;
  day: string;
  client_name: string | null;
  car_snapshot: RawHistoryBooking['car_snapshot'];
  odometer: number | null;
  work: string | null;
  cost: number | string | null;
}

const STATUSES: readonly HistoryDocStatus[] = ['done', 'quote_refused', 'expired', 'cancelled', 'no_show'];

const amount = (v: number | string | null): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const carName = (c: RawHistoryBooking['car_snapshot']) => [c?.make, c?.model, c?.year].filter(Boolean).join(' ');

/**
 * The rows the screen asked for, in its order: `ids` are the list's rows (bookings and imported jobs
 * by their id); an id that is not this shop's (not in what the person may read) is left out.
 */
export function historyDocRows(
  lang: Lang,
  ids: readonly string[],
  bookings: readonly RawHistoryBooking[],
  imported: readonly RawImportedJob[],
): HistoryDocRow[] {
  const byId = new Map<string, HistoryDocRow>();
  for (const b of bookings) {
    const status = STATUSES.find((s) => s === b.status);
    if (!status) continue;
    const names = [lang === 'en' ? b.service_en : b.service_ro, ...(b.extra_services ?? []).map((e) => (lang === 'en' ? e.name_en : e.name_ro))]
      .map((s) => (s ?? '').trim())
      .filter(Boolean);
    byId.set(b.id, {
      ended: b.ended_at,
      ref: b.ref,
      car: carName(b.car_snapshot),
      plate: b.car_snapshot?.plate ?? null,
      client: b.client_name,
      services: names.join(', ') || null,
      status,
      work: b.work,
      odometer: b.odometer,
      cost: amount(b.cost),
    });
  }
  for (const j of imported) {
    byId.set(j.id, {
      ended: j.day,
      ref: null,
      car: carName(j.car_snapshot),
      plate: j.car_snapshot?.plate ?? null,
      client: j.client_name,
      services: null,
      status: 'done',
      work: j.work,
      odometer: j.odometer,
      cost: amount(j.cost),
    });
  }
  return ids.map((id) => byId.get(id)).filter((r): r is HistoryDocRow => !!r);
}

/** The finished jobs and what they brought in (imported jobs are counted apart, as on the screen). */
export function historyDocTotals(rows: readonly HistoryDocRow[]): { jobs: number; revenue: number } {
  const done = rows.filter((r) => r.status === 'done' && r.ref !== null);
  return { jobs: done.length, revenue: done.reduce((s, r) => s + (r.cost ?? 0), 0) };
}

// ------------------------------------------------------------------ the texts

const TEXT = {
  ro: {
    title: 'Istoric reparații',
    issued: 'Emis {date}',
    cui: 'CUI {code}',
    regCom: 'Reg. Com. {code}',
    filters: 'Filtre: {filters}',
    jobs: 'Lucrări finalizate',
    revenue: 'Total încasat',
    rows: 'Rânduri',
    colDate: 'Data',
    colRef: 'Programare',
    colCar: 'Mașina',
    colClient: 'Client',
    colWork: 'Lucrare',
    colKm: 'Km',
    colAmount: 'Sumă',
    imported: 'Importat',
    empty: 'Nu există lucrări pentru filtrele selectate.',
    footer: 'Emis prin Service-Hub · Istoric reparații · Nu ține loc de factură fiscală.',
    page: 'Pagina {n} din {total}',
    'status.quote_refused': 'Deviz refuzat',
    'status.expired': 'Expirată',
    'status.cancelled': 'Anulată',
    'status.no_show': 'Neprezentat',
  },
  en: {
    title: 'Repair history',
    issued: 'Issued {date}',
    cui: 'VAT ID {code}',
    regCom: 'Trade reg. {code}',
    filters: 'Filters: {filters}',
    jobs: 'Jobs done',
    revenue: 'Total received',
    rows: 'Rows',
    colDate: 'Date',
    colRef: 'Booking',
    colCar: 'Car',
    colClient: 'Client',
    colWork: 'Job',
    colKm: 'Km',
    colAmount: 'Amount',
    imported: 'Imported',
    empty: 'No jobs match the selected filters.',
    footer: 'Issued through Service-Hub · Repair history · Not a tax invoice.',
    page: 'Page {n} of {total}',
    'status.quote_refused': 'Quote declined',
    'status.expired': 'Expired',
    'status.cancelled': 'Canceled',
    'status.no_show': 'No-show',
  },
} as const;

export type HistoryDocTextKey = keyof (typeof TEXT)['ro'];

export function historyDocText(lang: Lang, key: HistoryDocTextKey, params?: Record<string, string | number>): string {
  const template: string = TEXT[lang][key];
  return params ? template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : template;
}

// ------------------------------------------------------------------ the PDF

const PAGE: [number, number] = [595.28, 841.89]; // A4
const MARGIN = 40;
const CONTENT = PAGE[0] - 2 * MARGIN;
const FOOTER_H = 26;
const BOTTOM = MARGIN + FOOTER_H + 6;
const PAD = 5;

export async function renderHistoryPdf(lib: PdfLib, data: HistoryDocData, lang: Lang, now = new Date()): Promise<Uint8Array> {
  const t = (key: HistoryDocTextKey, params?: Record<string, string | number>) => historyDocText(lang, key, params);
  const hex = (h: string) => lib.rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  const C = {
    ink: hex('#1D2026'),
    muted: hex('#5F6570'),
    faint: hex('#8A909B'),
    line: hex('#E3E4E8'),
    band: hex('#F2F3F5'),
    amber: hex('#F5A524'),
    amberText: hex('#B26F00'),
  };

  const doc = (await (lib.PDFDocument as unknown as { create(): Promise<PdfDocument> }).create()) as PdfDocument;
  doc.registerFontkit(lib.fontkit);
  const sans = await doc.embedFont(base64Bytes(INTER_REGULAR), { subset: false });
  const bold = await doc.embedFont(base64Bytes(INTER_BOLD), { subset: false });
  const charset = new Set(sans.getCharacterSet());
  const clean = (s: string | null | undefined) => printable((s ?? '').toString().trim(), charset);

  const shop = data.shop ?? {};
  const shopTitle = clean(shop.legal_name || shop.name) || 'Service';
  const title = t('title');
  doc.setTitle(`${title} · ${clean(shop.name) || shopTitle}`);
  doc.setAuthor(shopTitle);
  doc.setSubject(title);
  doc.setCreator('Service-Hub');
  doc.setProducer('Service-Hub');
  doc.setLanguage(lang === 'en' ? 'en-US' : 'ro-RO');
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  let page = doc.addPage(PAGE);
  let y = PAGE[1] - MARGIN;

  const text = (s: string, x: number, baseline: number, size: number, font: PdfFont, color: Color) => {
    if (s) page.drawText(s, { x, y: baseline, size, font, color });
  };
  const right = (s: string, xRight: number, baseline: number, size: number, font: PdfFont, color: Color) =>
    text(s, xRight - font.widthOfTextAtSize(s, size), baseline, size, font, color);
  const lines = (s: string, font: PdfFont, size: number, width: number, max = 50) =>
    clampLines(wrapText(clean(s), font, size, width), max, font, size, width);
  const rule = (thickness = 0.6, color: Color = C.line) =>
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT, y }, thickness, color });

  // ---------------------------------------------------------------- header (every page)
  // The shop on the left (company, codes, address, phone), the document on the right: like the quote.
  const shopLines = [
    shop.legal_name && shop.name && clean(shop.legal_name) !== clean(shop.name) ? clean(shop.name) : '',
    [shop.vat_id ? t('cui', { code: clean(shop.vat_id) }) : '', shop.reg_com ? t('regCom', { code: clean(shop.reg_com) }) : '']
      .filter(Boolean)
      .join(' · '),
    clean(shop.legal_address) || [shop.street, shop.city, shop.county].map(clean).filter(Boolean).join(', '),
    clean(shop.phone),
  ].filter(Boolean);

  const header = (first: boolean) => {
    const leftW = CONTENT * 0.58;
    let ly = y - 13;
    for (const l of lines(shopTitle, bold, 12, leftW, 2)) {
      text(l, MARGIN, ly, 12, bold, C.ink);
      ly -= 14;
    }
    if (first) {
      for (const s of shopLines) {
        for (const l of lines(s, sans, 8.5, leftW, 2)) {
          text(l, MARGIN, ly, 8.5, sans, C.muted);
          ly -= 11;
        }
      }
    }
    let ry = y - 14;
    right(title.toUpperCase(), MARGIN + CONTENT, ry, 15, bold, C.ink);
    ry -= 15;
    right(t('issued', { date: docDay(lang, now.toISOString()) }), MARGIN + CONTENT, ry, 8.5, sans, C.muted);
    ry -= 11;
    y = Math.min(ly, ry) - 4;
    rule(1.6, C.amber);
    y -= 14;
  };

  // ---------------------------------------------------------------- the table's columns
  // Fixed widths for the short columns; the job takes what is left.
  const W = { date: 62, ref: 56, car: 94, client: 74, km: 54, amount: 58 };
  const workW = CONTENT - (W.date + W.ref + W.car + W.client + W.km + W.amount);
  const X = {
    date: MARGIN,
    ref: MARGIN + W.date,
    car: MARGIN + W.date + W.ref,
    client: MARGIN + W.date + W.ref + W.car,
    work: MARGIN + W.date + W.ref + W.car + W.client,
  };
  const kmR = MARGIN + CONTENT - W.amount - PAD;
  const amountR = MARGIN + CONTENT - PAD;

  const head = () => {
    page.drawRectangle({ x: MARGIN, y: y - 17, width: CONTENT, height: 17, color: C.band });
    const base = y - 11.5;
    text(t('colDate').toUpperCase(), X.date + PAD, base, 7, bold, C.ink);
    text(t('colRef').toUpperCase(), X.ref + PAD, base, 7, bold, C.ink);
    text(t('colCar').toUpperCase(), X.car + PAD, base, 7, bold, C.ink);
    text(t('colClient').toUpperCase(), X.client + PAD, base, 7, bold, C.ink);
    text(t('colWork').toUpperCase(), X.work + PAD, base, 7, bold, C.ink);
    right(t('colKm').toUpperCase(), kmR, base, 7, bold, C.ink);
    right(t('colAmount').toUpperCase(), amountR, base, 7, bold, C.ink);
    y -= 17;
  };

  const newPage = () => {
    page = doc.addPage(PAGE);
    y = PAGE[1] - MARGIN;
    header(false);
    head();
  };

  header(true);

  // ---------------------------------------------------------------- the summary
  const totals = historyDocTotals(data.rows);
  const facts: [string, string][] = [[t('rows'), String(data.rows.length)], [t('jobs'), String(totals.jobs)]];
  if (data.owner) facts.push([t('revenue'), docMoney(lang, totals.revenue)]);
  {
    const gap = 8;
    const w = (CONTENT - gap * (facts.length - 1)) / facts.length;
    facts.forEach(([label, value], i) => {
      const x = MARGIN + i * (w + gap);
      page.drawRectangle({ x, y: y - 38, width: w, height: 38, color: C.band });
      text(label.toUpperCase(), x + 10, y - 13, 7, bold, C.muted);
      text(clean(value), x + 10, y - 29, 11, bold, C.ink);
    });
    y -= 38 + 10;
  }
  if (data.filters) {
    for (const l of lines(t('filters', { filters: clean(data.filters) }), sans, 8.5, CONTENT, 3)) {
      text(l, MARGIN, y - 8.5, 8.5, sans, C.muted);
      y -= 11.5;
    }
    y -= 4;
  }
  y -= 4;

  // ---------------------------------------------------------------- the jobs
  head();
  if (data.rows.length === 0) {
    y -= 6;
    text(t('empty'), MARGIN + PAD, y - 9, 9, sans, C.muted);
    y -= 16;
  }
  for (const r of data.rows) {
    const date = lines(docDay(lang, r.ended), sans, 8.5, W.date - 2 * PAD, 1);
    const ref = lines(r.ref ?? t('imported'), r.ref ? sans : bold, 8, W.ref - 2 * PAD, 2);
    const car = [...lines(r.car, sans, 8.5, W.car - 2 * PAD, 2), ...(r.plate ? lines(r.plate, bold, 8.5, W.car - 2 * PAD, 1) : [])];
    const client = lines(r.client ?? '', sans, 8.5, W.client - 2 * PAD, 3);
    const work: [string, PdfFont, Color, number][] = [];
    if (r.services) for (const l of lines(r.services, bold, 8.5, workW - 2 * PAD, 3)) work.push([l, bold, C.ink, 8.5]);
    if (r.status !== 'done') work.push([t(`status.${r.status}` as HistoryDocTextKey), bold, C.amberText, 8]);
    if (r.work) for (const l of lines(r.work, sans, 8, workW - 2 * PAD, 4)) work.push([l, sans, C.muted, 8]);
    const km = r.odometer != null ? docKm(lang, r.odometer) : '';
    const money = r.cost != null ? docMoney(lang, r.cost) : '';

    const rowLines = Math.max(date.length, ref.length, car.length, client.length, work.length, 1);
    const h = rowLines * 11 + 9;
    if (y - h < BOTTOM) newPage();
    const top = y - 12;
    const column = (ls: readonly string[], x: number, font: PdfFont, color: Color, size = 8.5) =>
      ls.forEach((l, i) => text(l, x + PAD, top - i * 11, size, font, color));
    column(date, X.date, sans, C.ink);
    column(ref, X.ref, r.ref ? sans : bold, r.ref ? C.ink : C.muted, 8);
    car.forEach((l, i) => text(l, X.car + PAD, top - i * 11, 8.5, r.plate && i === car.length - 1 ? bold : sans, C.ink));
    column(client, X.client, sans, C.ink);
    work.forEach(([l, font, color, size], i) => text(l, X.work + PAD, top - i * 11, size, font, color));
    if (km) right(km, kmR, top, 8.5, sans, C.ink);
    if (money) right(money, amountR, top, 8.5, r.status === 'done' ? bold : sans, r.status === 'done' ? C.ink : C.faint);
    y -= h;
    rule();
  }

  // ---------------------------------------------------------------- footer (every page)
  const pages = doc.getPages();
  const footer = clean(t('footer'));
  pages.forEach((p, i) => {
    page = p;
    const top = MARGIN + FOOTER_H - 8;
    page.drawLine({ start: { x: MARGIN, y: top }, end: { x: MARGIN + CONTENT, y: top }, thickness: 0.6, color: C.line });
    text(clampLines([footer], 1, sans, 7, CONTENT - 80)[0] ?? '', MARGIN, MARGIN, 7, sans, C.muted);
    right(t('page', { n: i + 1, total: pages.length }), MARGIN + CONTENT, MARGIN, 7, bold, C.muted);
  });

  return doc.save();
}
