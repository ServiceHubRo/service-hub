// The history report as a PDF (T15, P16e; the look of docs/reference-report.pdf): A4, white, dark
// text, the amber accent, Inter (the app's typeface) with the Romanian letters embedded (reportFonts.ts).
//
// pdf-lib and fontkit are handed in (`PdfLib`): the Edge Function passes `npm:pdf-lib`, the unit
// tests the same package from node_modules, so this file imports neither and stays testable.
import {
  jobService,
  reportCarName,
  reportDay,
  reportKm,
  reportMoment,
  reportMoney,
  reportPeriod,
  reportText,
  type ReportData,
  type ReportTextKey,
} from './report.ts';
import { INTER_BOLD, INTER_REGULAR } from './reportFonts.ts';

// ------------------------------------------------------------------ the parts of pdf-lib used here

type Color = object;

export interface PdfFont {
  widthOfTextAtSize(text: string, size: number): number;
  getCharacterSet(): number[];
}

interface PdfPage {
  drawText(text: string, options: { x: number; y: number; size: number; font: PdfFont; color: Color }): void;
  drawRectangle(options: { x: number; y: number; width: number; height: number; color?: Color }): void;
  drawLine(options: { start: { x: number; y: number }; end: { x: number; y: number }; thickness: number; color: Color }): void;
  drawSvgPath(
    path: string,
    options: { x: number; y: number; scale?: number; color?: Color; borderColor?: Color; borderWidth?: number; borderLineCap?: number },
  ): void;
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

export interface PdfLib {
  PDFDocument: { create(): Promise<PdfDocument> };
  rgb(r: number, g: number, b: number): Color;
  fontkit: unknown;
}

// ------------------------------------------------------------------ layout

const PAGE: [number, number] = [595.28, 841.89]; // A4
const MARGIN = 40;
const CONTENT = PAGE[0] - 2 * MARGIN;
/** The running footer: a line, the note on what the report covers (2 lines), verify + page. */
const FOOTER_H = 40;
const BOTTOM = MARGIN + FOOTER_H + 6; // lowest point the content may reach

/** Column left edges and widths of the jobs table (they add up to CONTENT). */
const COLS = { date: 72, shop: 132, work: 173, km: 58, cost: 80 };
const PAD = 8;

/** The brand's wrench (docs/brand/logo, Lucide `wrench`), drawn on a 24-unit grid. */
const WRENCH =
  'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z';

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Rounded rectangle as an SVG path from its top-left corner (drawSvgPath's origin). */
function roundRectPath(w: number, h: number, r: number): string {
  return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
}

/** One typeface, as in the app; its digits are even-width, so figures line up without a mono font. */
interface Fonts {
  sans: PdfFont;
  bold: PdfFont;
}

/**
 * Text as the fonts can print it: NFC, one line, and any letter the embedded fonts lack (emoji,
 * Cyrillic, …) left out instead of printed as an empty box.
 */
export function printable(text: string, charset: ReadonlySet<number>): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const cp = ch.codePointAt(0)!;
    out += cp < 0x20 ? ' ' : charset.has(cp) ? ch : '';
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Lines of at most `width` points; a word too long for a line is cut. */
export function wrapText(text: string, font: PdfFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    let rest = word;
    while (!fits(rest)) {
      let n = rest.length - 1;
      while (n > 1 && !fits(rest.slice(0, n))) n--;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

/** At most `max` lines, the last one ending in `…` when text was left out. */
function clampLines(lines: string[], max: number, font: PdfFont, size: number, width: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1]!;
  while (last && font.widthOfTextAtSize(`${last}…`, size) > width) last = last.slice(0, -1);
  kept[max - 1] = `${last.trimEnd()}…`;
  return kept;
}

/** The report as PDF bytes. */
export async function renderReportPdf(lib: PdfLib, data: ReportData): Promise<Uint8Array> {
  const { lang } = data;
  const t = (key: ReportTextKey, params?: Record<string, string | number>) => reportText(lang, key, params);
  const hex = (h: string) => lib.rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  const C = {
    ink: hex('#1D2026'),
    muted: hex('#5F6570'),
    faint: hex('#8A909B'),
    line: hex('#E3E4E8'),
    box: hex('#D9DBE0'),
    amber: hex('#F5A524'),
    amberText: hex('#B26F00'),
    amberTint: hex('#FCF1DE'),
    amberLine: hex('#EDD3A2'),
    wrench: hex('#151515'),
    white: hex('#FFFFFF'),
  };

  const doc = await lib.PDFDocument.create();
  doc.registerFontkit(lib.fontkit);
  // Not subset again: the fonts are already cut down, and whole fonts avoid fontkit's subsetting quirks.
  const fonts: Fonts = {
    sans: await doc.embedFont(base64Bytes(INTER_REGULAR), { subset: false }),
    bold: await doc.embedFont(base64Bytes(INTER_BOLD), { subset: false }),
  };
  const charset = new Set(fonts.sans.getCharacterSet());
  const clean = (s: string | null | undefined) => printable((s ?? '').trim(), charset);

  const generated = reportMoment(lang, data.generatedAt);
  const carName = clean(reportCarName(lang, data.car));
  doc.setTitle(`${t('title')} ${data.code} · ${carName}`);
  doc.setAuthor('Service-Hub');
  doc.setSubject(`${t('title')} · ${carName}`);
  doc.setCreator('Service-Hub');
  doc.setProducer('Service-Hub');
  doc.setLanguage(lang === 'en' ? 'en-US' : 'ro-RO');
  doc.setCreationDate(new Date(data.generatedAt));
  doc.setModificationDate(new Date(data.generatedAt));

  let page = doc.addPage(PAGE);
  let y = PAGE[1] - MARGIN; // top of the free space

  const text = (s: string, x: number, baseline: number, size: number, font: PdfFont, color: Color) => {
    if (s) page.drawText(s, { x, y: baseline, size, font, color });
  };
  const right = (s: string, xRight: number, baseline: number, size: number, font: PdfFont, color: Color) =>
    text(s, xRight - font.widthOfTextAtSize(s, size), baseline, size, font, color);
  const center = (s: string, xCenter: number, baseline: number, size: number, font: PdfFont, color: Color) =>
    text(s, xCenter - font.widthOfTextAtSize(s, size) / 2, baseline, size, font, color);
  const box = (x: number, top: number, w: number, h: number, fill: Color, border: Color) =>
    page.drawSvgPath(roundRectPath(w, h, 6), { x, y: top, color: fill, borderColor: border, borderWidth: 0.8 });

  // ---------------------------------------------------------------- the running header
  // Every page starts the same way: who issued it, what it is, when. Pages after the first also
  // say which car and which report code, so a loose page is never anonymous.
  const plate = clean(data.car.plate);
  const vin = clean(data.car.vin);
  const header = (first: boolean) => {
    const tile = 26;
    page.drawSvgPath(roundRectPath(tile, tile, 6), { x: MARGIN, y, color: C.amber });
    page.drawSvgPath(WRENCH, {
      x: MARGIN + tile * 0.225,
      y: y - tile * 0.225,
      scale: (tile * 0.55) / 24,
      borderColor: C.wrench,
      borderWidth: 2.5,
      borderLineCap: 1,
    });
    const wordX = MARGIN + tile + 7;
    text('SERVICE-', wordX, y - 19, 17, fonts.bold, C.ink);
    text('HUB', wordX + fonts.bold.widthOfTextAtSize('SERVICE-', 17), y - 19, 17, fonts.bold, C.amber);

    right(t('title'), MARGIN + CONTENT, y - 12, 12, fonts.bold, C.ink);
    right(t('generated', generated), MARGIN + CONTENT, y - 26, 8, fonts.sans, C.muted);
    right(clean(data.verifyAt.split('/')[0]), MARGIN + CONTENT, y - 37, 8, fonts.sans, C.muted);
    y -= 48;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT, y }, thickness: 1.6, color: C.amber });
    if (first) {
      y -= 30;
      return;
    }
    // Which car, which report: the identity strip under the rule.
    const codeW = fonts.bold.widthOfTextAtSize(data.code, 10);
    const room = CONTENT - codeW - 16;
    const name = clampLines(wrapText(carName, fonts.bold, 10, room), 1, fonts.bold, 10, room)[0] ?? '';
    text(name, MARGIN, y - 16, 10, fonts.bold, C.ink);
    const ids = [plate, vin].filter(Boolean).join(' · ');
    const idsLine = clampLines(wrapText(ids, fonts.sans, 8, room), 1, fonts.sans, 8, room)[0] ?? '';
    text(idsLine, MARGIN, y - 28, 8, fonts.sans, C.muted);
    right(data.code, MARGIN + CONTENT, y - 16, 10, fonts.bold, C.amberText);
    right(t('continued'), MARGIN + CONTENT, y - 28, 7.5, fonts.sans, C.muted);
    y -= 44;
  };

  const newPage = () => {
    page = doc.addPage(PAGE);
    y = PAGE[1] - MARGIN;
    header(false);
  };
  const ensure = (height: number) => {
    if (y - height < BOTTOM) newPage();
  };

  header(true);

  // ---------------------------------------------------------------- the car
  text(carName, MARGIN, y - 4, 20, fonts.bold, C.ink);
  y -= 22;
  text(t('subtitle'), MARGIN, y - 6, 9, fonts.sans, C.muted);
  y -= 22;

  const facts: [string, string, PdfFont][] = [
    [t('plate'), plate || t('none'), fonts.bold],
    [t('year'), clean(data.car.year != null ? String(data.car.year) : '') || t('none'), fonts.bold],
    [t('vin'), vin || t('none'), fonts.bold],
  ];
  const gap = 6;
  const factW = (CONTENT - 2 * gap) / 3;
  facts.forEach(([label, value, font], i) => {
    const x = MARGIN + i * (factW + gap);
    box(x, y, factW, 46, C.white, C.box);
    text(label, x + 12, y - 17, 7.5, fonts.sans, C.muted);
    const size = font.widthOfTextAtSize(value, 10) > factW - 24 ? 8.5 : 10;
    text(value, x + 12, y - 33, size, font, C.ink);
  });
  y -= 46 + 14;

  // ---------------------------------------------------------------- the code
  box(MARGIN, y, CONTENT, 42, C.amberTint, C.amberLine);
  text(t('code'), MARGIN + 12, y - 17, 8, fonts.bold, C.amberText);
  text(t('codeHint'), MARGIN + 12, y - 30, 7.5, fonts.sans, C.muted);
  right(data.code, MARGIN + CONTENT - 12, y - 26, 15, fonts.bold, C.amberText);
  y -= 42 + 16;

  // ---------------------------------------------------------------- the jobs, measured first
  const colX = {
    date: MARGIN,
    shop: MARGIN + COLS.date,
    work: MARGIN + COLS.date + COLS.shop,
    kmRight: MARGIN + COLS.date + COLS.shop + COLS.work + COLS.km - PAD,
    costRight: MARGIN + CONTENT - PAD,
  };
  const TABLE_HEAD = 22;
  const tableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - TABLE_HEAD, width: CONTENT, height: TABLE_HEAD, color: C.ink });
    const base = y - 14.5;
    text(t('colDate'), colX.date + PAD, base, 8, fonts.bold, C.white);
    text(t('colShop'), colX.shop + PAD, base, 8, fonts.bold, C.white);
    text(t('colWork'), colX.work + PAD, base, 8, fonts.bold, C.white);
    right(t('colKm'), colX.kmRight, base, 8, fonts.bold, C.white);
    right(t('colCost'), colX.costRight, base, 8, fonts.bold, C.white);
    y -= TABLE_HEAD;
  };

  const LEAD = 12.5;
  const SMALL = 10.5;
  const shopW = COLS.shop - 2 * PAD;
  const workW = COLS.work - 2 * PAD;
  const rows = data.jobs.map((job) => {
    const shopLines = clampLines(wrapText(clean(job.shop_name) || t('unknownShop'), fonts.sans, 9, shopW), 2, fonts.sans, 9, shopW);
    const cityLines = clampLines(wrapText(clean(job.shop_city), fonts.sans, 7.5, shopW), 1, fonts.sans, 7.5, shopW);
    const serviceLines = clampLines(wrapText(clean(jobService(lang, job)), fonts.sans, 9, workW), 2, fonts.sans, 9, workW);
    const itemLines = clampLines(wrapText(clean(job.items.join(' · ')), fonts.sans, 7.5, workW), 3, fonts.sans, 7.5, workW);
    const workText = clean(job.work);
    const workLines =
      workText && workText !== clean(jobService(lang, job))
        ? clampLines(wrapText(workText, fonts.sans, 7.5, workW), 3, fonts.sans, 7.5, workW)
        : [];
    const leftH = shopLines.length * LEAD + cityLines.length * SMALL;
    const workH = serviceLines.length * LEAD + (itemLines.length + workLines.length) * SMALL;
    return { job, shopLines, cityLines, serviceLines, notes: [...itemLines, ...workLines], height: Math.max(leftH, workH, LEAD) + 14 };
  });

  // What closes the report (total, figures, the odometer note, the notice): one block
  // that always travels with the last job, so it never sits alone on a page of its own.
  const TOTAL_H = 30 + 14;
  const STATS_H = 56 + 12;
  const kmNote = data.odometerOutOfOrder ? wrapText(t('kmNote'), fonts.sans, 7.5, CONTENT - 4) : [];
  const KM_NOTE_H = kmNote.length ? kmNote.length * 10 + 10 : 0;
  const noticeLead = t('disclaimerLead');
  const notice = clean(`${noticeLead} ${t('disclaimer', { date: generated.date, host: data.verifyAt.split('/')[0] ?? '' })}`);
  const noticeLines = wrapText(notice, fonts.sans, 6.5, CONTENT);
  const NOTICE_H = 6 + noticeLines.length * 8.5;
  const CLOSING_H = TOTAL_H + STATS_H + KM_NOTE_H + NOTICE_H;

  // ---------------------------------------------------------------- the jobs, drawn
  // A row is never split; the table header repeats on every page it continues on.
  if (y - TABLE_HEAD - (rows[0]?.height ?? 0) < BOTTOM) newPage();
  tableHeader();
  rows.forEach((row, i) => {
    const last = i === rows.length - 1;
    const needed = row.height + (last ? CLOSING_H : 0);
    if (y - needed < BOTTOM) {
      newPage();
      tableHeader();
    }
    const top = y - 16;
    text(reportDay(lang, row.job.date), colX.date + PAD, top, 9, fonts.sans, C.ink);
    let ly = top;
    for (const l of row.shopLines) {
      text(l, colX.shop + PAD, ly, 9, fonts.sans, C.ink);
      ly -= LEAD;
    }
    for (const l of row.cityLines) {
      text(l, colX.shop + PAD, ly + 1.5, 7.5, fonts.sans, C.muted);
      ly -= SMALL;
    }
    let wy = top;
    for (const l of row.serviceLines) {
      text(l, colX.work + PAD, wy, 9, fonts.sans, C.ink);
      wy -= LEAD;
    }
    for (const l of row.notes) {
      text(l, colX.work + PAD, wy + 1.5, 7.5, fonts.sans, C.muted);
      wy -= SMALL;
    }
    right(row.job.odometer != null ? reportKm(lang, row.job.odometer) : t('none'), colX.kmRight, top, 9, fonts.sans, C.ink);
    right(row.job.cost != null ? reportMoney(lang, row.job.cost) : t('none'), colX.costRight, top, 9, fonts.sans, C.ink);
    y -= row.height;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT, y }, thickness: 0.6, color: C.line });
  });

  // ---------------------------------------------------------------- the closing block
  ensure(CLOSING_H);
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT, y }, thickness: 1, color: C.ink });
  text(t('total'), MARGIN + PAD, y - 18, 9.5, fonts.bold, C.ink);
  right(reportMoney(lang, data.total), colX.costRight, y - 18, 11, fonts.bold, C.ink);
  y -= TOTAL_H;

  const stats: [string, string][] = [
    [t('jobs'), String(data.jobs.length)],
    [t('period'), reportPeriod(lang, data.periodFrom, data.periodTo)],
    [t('lastKm'), data.latestOdometer != null ? reportKm(lang, data.latestOdometer) : t('none')],
  ];
  stats.forEach(([label, value], i) => {
    const x = MARGIN + i * (factW + gap);
    box(x, y, factW, 56, C.white, C.box);
    center(label, x + factW / 2, y - 17, 7.5, fonts.sans, C.muted);
    const size = fonts.bold.widthOfTextAtSize(value, 15) > factW - 16 ? 11 : 15;
    center(value, x + factW / 2, y - 40, size, fonts.bold, C.amberText);
  });
  y -= STATS_H;

  if (kmNote.length) {
    for (const l of kmNote) {
      text(l, MARGIN + 2, y - 8, 7.5, fonts.sans, C.muted);
      y -= 10;
    }
    y -= 10;
  }


  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT, y }, thickness: 0.6, color: C.line });
  y -= 6;
  noticeLines.forEach((l, i) => {
    if (i === 0 && l.startsWith(noticeLead)) {
      text(noticeLead, MARGIN, y - 7, 6.5, fonts.bold, C.muted);
      text(l.slice(noticeLead.length), MARGIN + fonts.bold.widthOfTextAtSize(noticeLead, 6.5), y - 7, 6.5, fonts.sans, C.faint);
    } else {
      text(l, MARGIN, y - 7, 6.5, fonts.sans, C.faint);
    }
    y -= 8.5;
  });

  // ---------------------------------------------------------------- the running footer
  // Every page ends the same way: what the report covers, where and how to verify it (the check
  // needs no account), which page.
  const pages = doc.getPages();
  const footerNote = clampLines(wrapText(clean(t('footerNote')), fonts.sans, 6.5, CONTENT), 2, fonts.sans, 6.5, CONTENT);
  const address = clean(data.verifyAt);
  const footerVerify = clean(t('footerVerify', { address, code: data.code }));
  pages.forEach((p, i) => {
    page = p;
    const top = MARGIN + FOOTER_H - 6;
    page.drawLine({ start: { x: MARGIN, y: top }, end: { x: MARGIN + CONTENT, y: top }, thickness: 0.6, color: C.line });
    footerNote.forEach((l, n) => text(l, MARGIN, top - 10 - n * 8.5, 6.5, fonts.sans, C.faint));
    const base = MARGIN - 2;
    text(footerVerify, MARGIN, base, 7, fonts.sans, C.muted);
    right(t('page', { n: i + 1, total: pages.length }), MARGIN + CONTENT, base, 7, fonts.bold, C.muted);
  });

  return doc.save();
}
