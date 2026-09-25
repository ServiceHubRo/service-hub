// The history report as a PDF (T15, P16e; the look of docs/reference-report.pdf): A4, white, dark
// text, the amber accent, Noto Sans with the Romanian letters embedded (reportFonts.ts).
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
import { MONO_BOLD, MONO_REGULAR, SANS_BOLD, SANS_REGULAR } from './reportFonts.ts';

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
const BOTTOM = MARGIN + 26; // room for the page footer

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

interface Fonts {
  sans: PdfFont;
  bold: PdfFont;
  mono: PdfFont;
  monoBold: PdfFont;
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
    sans: await doc.embedFont(base64Bytes(SANS_REGULAR), { subset: false }),
    bold: await doc.embedFont(base64Bytes(SANS_BOLD), { subset: false }),
    mono: await doc.embedFont(base64Bytes(MONO_REGULAR), { subset: false }),
    monoBold: await doc.embedFont(base64Bytes(MONO_BOLD), { subset: false }),
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
  const newPage = () => {
    page = doc.addPage(PAGE);
    y = PAGE[1] - MARGIN;
    text(clean(t('continued', { title: t('title'), code: data.code })), MARGIN, y - 10, 8.5, fonts.sans, C.muted);
    y -= 26;
  };
  const ensure = (height: number) => {
    if (y - height < BOTTOM) newPage();
  };

  // ---------------------------------------------------------------- header
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
  y -= 30;

  // ---------------------------------------------------------------- the car
  text(carName, MARGIN, y - 4, 20, fonts.bold, C.ink);
  y -= 22;
  text(t('subtitle'), MARGIN, y - 6, 9, fonts.sans, C.muted);
  y -= 22;

  const facts: [string, string, PdfFont][] = [
    [t('plate'), clean(data.car.plate) || t('none'), fonts.bold],
    [t('year'), clean(data.car.year != null ? String(data.car.year) : '') || t('none'), fonts.bold],
    [t('vin'), clean(data.car.vin) || t('none'), fonts.bold],
  ];
  const gap = 6;
  const factW = (CONTENT - 2 * gap) / 3;
  facts.forEach(([label, value, font], i) => {
    const x = MARGIN + i * (factW + gap);
    box(x, y, factW, 46, C.white, C.box);
    text(label, x + 12, y - 17, 6.5, fonts.sans, C.faint);
    const size = font.widthOfTextAtSize(value, 10) > factW - 24 ? 8.5 : 10;
    text(value, x + 12, y - 33, size, font, C.ink);
  });
  y -= 46 + 14;

  // ---------------------------------------------------------------- the code
  box(MARGIN, y, CONTENT, 42, C.amberTint, C.amberLine);
  text(t('code'), MARGIN + 12, y - 17, 7, fonts.bold, C.amberText);
  text(t('codeHint'), MARGIN + 12, y - 30, 7.5, fonts.sans, C.muted);
  right(data.code, MARGIN + CONTENT - 12, y - 26, 15, fonts.monoBold, C.amberText);
  y -= 42 + 16;

  // ---------------------------------------------------------------- the jobs
  const colX = {
    date: MARGIN,
    shop: MARGIN + COLS.date,
    work: MARGIN + COLS.date + COLS.shop,
    kmRight: MARGIN + COLS.date + COLS.shop + COLS.work + COLS.km - PAD,
    costRight: MARGIN + CONTENT - PAD,
  };
  const tableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 22, width: CONTENT, height: 22, color: C.ink });
    const base = y - 14.5;
    text(t('colDate'), colX.date + PAD, base, 7, fonts.bold, C.white);
    text(t('colShop'), colX.shop + PAD, base, 7, fonts.bold, C.white);
    text(t('colWork'), colX.work + PAD, base, 7, fonts.bold, C.white);
    right(t('colKm'), colX.kmRight, base, 7, fonts.bold, C.white);
    right(t('colCost'), colX.costRight, base, 7, fonts.bold, C.white);
    y -= 22;
  };
  ensure(22 + 40);
  tableHeader();

  const LEAD = 12.5;
  const SMALL = 10.5;
  for (const job of data.jobs) {
    const shopW = COLS.shop - 2 * PAD;
    const workW = COLS.work - 2 * PAD;
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
    const rowH = Math.max(leftH, workH, LEAD) + 14;

    if (y - rowH < BOTTOM) {
      newPage();
      tableHeader();
    }
    const top = y - 16;
    text(reportDay(lang, job.date), colX.date + PAD, top, 9, fonts.mono, C.ink);
    let ly = top;
    for (const l of shopLines) {
      text(l, colX.shop + PAD, ly, 9, fonts.sans, C.ink);
      ly -= LEAD;
    }
    for (const l of cityLines) {
      text(l, colX.shop + PAD, ly + 1.5, 7.5, fonts.sans, C.muted);
      ly -= SMALL;
    }
    let wy = top;
    for (const l of serviceLines) {
      text(l, colX.work + PAD, wy, 9, fonts.sans, C.ink);
      wy -= LEAD;
    }
    for (const l of [...itemLines, ...workLines]) {
      text(l, colX.work + PAD, wy + 1.5, 7.5, fonts.sans, C.muted);
      wy -= SMALL;
    }
    right(job.odometer != null ? reportKm(lang, job.odometer) : t('none'), colX.kmRight, top, 9, fonts.mono, C.ink);
    right(job.cost != null ? reportMoney(lang, job.cost) : t('none'), colX.costRight, top, 9, fonts.mono, C.ink);
    y -= rowH;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT, y }, thickness: 0.6, color: C.line });
  }

  ensure(30);
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT, y }, thickness: 1, color: C.ink });
  text(t('total'), MARGIN + PAD, y - 18, 9.5, fonts.bold, C.ink);
  right(reportMoney(lang, data.total), colX.costRight, y - 18, 11, fonts.monoBold, C.ink);
  y -= 30 + 14;

  // ---------------------------------------------------------------- totals
  ensure(64);
  const stats: [string, string][] = [
    [t('jobs'), String(data.jobs.length)],
    [t('period'), reportPeriod(lang, data.periodFrom, data.periodTo)],
    [t('lastKm'), data.latestOdometer != null ? reportKm(lang, data.latestOdometer) : t('none')],
  ];
  stats.forEach(([label, value], i) => {
    const x = MARGIN + i * (factW + gap);
    box(x, y, factW, 56, C.white, C.box);
    center(label, x + factW / 2, y - 17, 6.5, fonts.sans, C.faint);
    const size = fonts.bold.widthOfTextAtSize(value, 15) > factW - 16 ? 11 : 15;
    center(value, x + factW / 2, y - 40, size, fonts.bold, C.amberText);
  });
  y -= 56 + 12;

  if (data.odometerOutOfOrder) {
    const lines = wrapText(t('kmNote'), fonts.sans, 7.5, CONTENT - 4);
    ensure(lines.length * 10 + 10);
    for (const l of lines) {
      text(l, MARGIN + 2, y - 8, 7.5, fonts.sans, C.muted);
      y -= 10;
    }
    y -= 10;
  }

  // ---------------------------------------------------------------- verification
  ensure(62);
  box(MARGIN, y, CONTENT, 50, C.white, C.box);
  text(t('verifyTitle'), MARGIN + 14, y - 20, 9.5, fonts.bold, C.ink);
  const verifyLines = clampLines(wrapText(t('verifyBody'), fonts.sans, 8, CONTENT * 0.58), 2, fonts.sans, 8, CONTENT * 0.58);
  verifyLines.forEach((l, i) => text(l, MARGIN + 14, y - 33 - i * 10, 8, fonts.sans, C.ink));
  const address = clean(data.verifyAt);
  const codeX = MARGIN + CONTENT - 14 - Math.max(fonts.mono.widthOfTextAtSize(address, 9), fonts.mono.widthOfTextAtSize(data.code, 9));
  text(address, codeX, y - 20, 9, fonts.mono, C.amberText);
  text(data.code, codeX, y - 33, 9, fonts.mono, C.amberText);
  y -= 50 + 14;

  // ---------------------------------------------------------------- disclaimer
  const disclaimer = clean(`${t('disclaimerLead')} ${t('disclaimer', { date: generated.date, host: data.verifyAt.split('/')[0] ?? '' })}`);
  const lines = wrapText(disclaimer, fonts.sans, 6.5, CONTENT);
  ensure(lines.length * 8.5 + 10);
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT, y }, thickness: 0.6, color: C.line });
  y -= 6;
  lines.forEach((l, i) => {
    const lead = t('disclaimerLead');
    if (i === 0 && l.startsWith(lead)) {
      text(lead, MARGIN, y - 7, 6.5, fonts.bold, C.muted);
      text(l.slice(lead.length), MARGIN + fonts.bold.widthOfTextAtSize(lead, 6.5), y - 7, 6.5, fonts.sans, C.faint);
    } else {
      text(l, MARGIN, y - 7, 6.5, fonts.sans, C.faint);
    }
    y -= 8.5;
  });

  // ---------------------------------------------------------------- page footers
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    page = p;
    const label = `${data.code} · ${t('page', { n: i + 1, total: pages.length })}`;
    center(label, PAGE[0] / 2, MARGIN - 14, 7, fonts.sans, C.faint);
  });

  return doc.save();
}
