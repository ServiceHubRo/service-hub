// The quote, the final quote and the intake sheet as PDFs (T50): A4, white, dark text, the amber
// accent and Inter, like the history report (reportPdf.ts), laid out like a paper quote: the shop
// and the document number at the top, client and vehicle side by side, labor and parts in tables,
// the totals with VAT, the client's agreement, and the shop's own terms.
//
// pdf-lib and fontkit are handed in (`PdfLib`), so the unit tests run this file as it is.
import { CAR_PATHS, CAR_VIEW } from './carDiagram.ts';
import {
  consentText,
  damageKindText,
  docAmount,
  docCarName,
  docDay,
  docDuration,
  docKm,
  docLines,
  docMoment,
  docMoney,
  docMonths,
  docNumber,
  docQuantity,
  docTotals,
  fuelText,
  jobDocText,
  lineCounts,
  type JobDocData,
  type JobDocItem,
  type JobDocTextKey,
} from './jobDoc.ts';
import { INTER_BOLD, INTER_REGULAR } from './reportFonts.ts';
import { base64Bytes, clampLines, printable, roundRectPath, wrapText, type PdfFont, type PdfLib } from './reportPdf.ts';

type Color = object;

interface PdfImage {
  width: number;
  height: number;
}

interface PdfPage {
  drawText(text: string, options: { x: number; y: number; size: number; font: PdfFont; color: Color }): void;
  drawRectangle(options: { x: number; y: number; width: number; height: number; color?: Color; borderColor?: Color; borderWidth?: number }): void;
  drawLine(options: { start: { x: number; y: number }; end: { x: number; y: number }; thickness: number; color: Color }): void;
  drawSvgPath(
    path: string,
    options: { x: number; y: number; scale?: number; color?: Color; borderColor?: Color; borderWidth?: number; borderLineCap?: number },
  ): void;
  drawCircle(options: { x: number; y: number; size: number; color?: Color; borderColor?: Color; borderWidth?: number }): void;
  drawImage(image: PdfImage, options: { x: number; y: number; width: number; height: number }): void;
}

interface PdfDocument {
  registerFontkit(fontkit: unknown): void;
  embedFont(bytes: Uint8Array, options?: { subset?: boolean }): Promise<PdfFont>;
  embedJpg(bytes: Uint8Array): Promise<PdfImage>;
  embedPng(bytes: Uint8Array): Promise<PdfImage>;
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

/** A photo of the intake, already read from Storage. */
export interface DocPhoto {
  bytes: Uint8Array;
  type: 'jpg' | 'png';
}

const PAGE: [number, number] = [595.28, 841.89]; // A4
const MARGIN = 40;
const CONTENT = PAGE[0] - 2 * MARGIN;
const FOOTER_H = 26;
const BOTTOM = MARGIN + FOOTER_H + 6;
const PAD = 6;

export async function renderJobPdf(lib: PdfLib, data: JobDocData, lang: 'ro' | 'en', photos: DocPhoto[] = [], now = new Date()): Promise<Uint8Array> {
  const t = (key: JobDocTextKey, params?: Record<string, string | number>) => jobDocText(lang, key, params);
  const hex = (h: string) => lib.rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  const C = {
    ink: hex('#1D2026'),
    muted: hex('#5F6570'),
    faint: hex('#8A909B'),
    line: hex('#E3E4E8'),
    box: hex('#D9DBE0'),
    band: hex('#F2F3F5'),
    amber: hex('#F5A524'),
    amberText: hex('#B26F00'),
    amberTint: hex('#FCF1DE'),
    green: hex('#1F7A3C'),
    greenTint: hex('#E6F4EA'),
    white: hex('#FFFFFF'),
    car: hex('#9AA0AA'),
  };

  const doc = (await (lib.PDFDocument as unknown as { create(): Promise<PdfDocument> }).create()) as PdfDocument;
  doc.registerFontkit(lib.fontkit);
  const sans = await doc.embedFont(base64Bytes(INTER_REGULAR), { subset: false });
  const bold = await doc.embedFont(base64Bytes(INTER_BOLD), { subset: false });
  const charset = new Set(sans.getCharacterSet());
  const clean = (s: string | null | undefined) => printable((s ?? '').toString().trim(), charset);

  const b = data.booking;
  const q = data.quote;
  const shop = data.shop ?? {};
  const kindTitle = t(`title.${data.kind}` as JobDocTextKey);
  const number = b.quote_number != null ? docNumber(b.quote_number) : null;
  const carName = clean(docCarName(b.car));

  doc.setTitle(`${kindTitle}${number ? ` ${number}` : ''} · ${carName || b.ref}`);
  doc.setAuthor(clean(shop.legal_name || shop.name) || 'Service-Hub');
  doc.setSubject(kindTitle);
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
  const box = (x: number, top: number, w: number, h: number, fill: Color, border: Color) =>
    page.drawSvgPath(roundRectPath(w, h, 5), { x, y: top, color: fill, borderColor: border, borderWidth: 0.8 });
  const rule = (thickness = 0.6, color: Color = C.line) =>
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT, y }, thickness, color });

  // ---------------------------------------------------------------- header (every page)
  // The shop on the left (company, codes, address, phone), the document on the right.
  const shopTitle = clean(shop.legal_name || shop.name) || 'Service';
  const shopLines = [
    shop.legal_name && shop.name && clean(shop.legal_name) !== clean(shop.name) ? clean(shop.name) : '',
    [shop.vat_id ? t('cui', { code: clean(shop.vat_id) }) : '', shop.reg_com ? t('regCom', { code: clean(shop.reg_com) }) : '']
      .filter(Boolean)
      .join(' · '),
    clean(shop.legal_address) || [shop.street, shop.city, shop.county].map(clean).filter(Boolean).join(', '),
    clean(shop.phone),
  ].filter(Boolean);

  const issuedAt =
    data.kind === 'final' ? b.done_at : data.kind === 'intake' ? (data.intake?.created_at ?? null) : (q?.sent_at ?? null);

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
    right(kindTitle.toUpperCase(), MARGIN + CONTENT, ry, 15, bold, C.ink);
    ry -= 15;
    if (number && data.kind !== 'intake') {
      right(t('number', { n: number }), MARGIN + CONTENT, ry, 10, bold, C.amberText);
      ry -= 13;
    }
    if (data.kind === 'intake' && number) {
      right(t('annex', { n: number }), MARGIN + CONTENT, ry, 8.5, sans, C.muted);
      ry -= 11;
    }
    if (issuedAt) {
      right(t('issued', { date: docDay(lang, issuedAt) }), MARGIN + CONTENT, ry, 8.5, sans, C.muted);
      ry -= 11;
    }
    if (!first) {
      right(clean([carName, b.car.plate].filter(Boolean).join(' · ')), MARGIN + CONTENT, ry, 8, sans, C.muted);
      ry -= 11;
    }
    y = Math.min(ly, ry) - 4;
    rule(1.6, C.amber);
    y -= 14;
  };

  const newPage = () => {
    page = doc.addPage(PAGE);
    y = PAGE[1] - MARGIN;
    header(false);
  };
  const ensure = (h: number) => {
    if (y - h < BOTTOM) newPage();
  };

  header(true);

  // ---------------------------------------------------------------- client and vehicle
  const colW = (CONTENT - 10) / 2;
  const clientRows: [string, PdfFont, Color][] = [];
  const recipient = data.recipient;
  if (recipient?.kind !== 'person' && recipient?.company_name) {
    clientRows.push([clean(recipient.company_name), bold, C.ink]);
    const codes = [
      recipient.vat_id ? t('cui', { code: clean(recipient.vat_id) }) : '',
      recipient.reg_com ? t('regCom', { code: clean(recipient.reg_com) }) : '',
    ].filter(Boolean);
    if (codes.length) clientRows.push([codes.join(' · '), sans, C.ink]);
    if (recipient.address) clientRows.push([clean(recipient.address), sans, C.ink]);
    if (b.client_name) clientRows.push([clean(b.client_name), sans, C.muted]);
  } else {
    clientRows.push([clean(b.client_name) || t('none'), bold, C.ink]);
    if (recipient?.address) clientRows.push([clean(recipient.address), sans, C.ink]);
  }
  if (b.client_phone) clientRows.push([clean(b.client_phone), sans, C.muted]);

  const kmIn = data.intake?.odometer ?? null;
  const vehicleRows: [string, PdfFont, Color][] = [[carName || t('none'), bold, C.ink]];
  if (b.car.plate) vehicleRows.push([`${t('plate')}: ${clean(b.car.plate)}`, sans, C.ink]);
  if (b.car.vin) vehicleRows.push([`${t('vin')}: ${clean(b.car.vin)}`, sans, C.ink]);
  if (kmIn != null && data.kind !== 'intake') vehicleRows.push([`${t('kmIn')}: ${docKm(lang, kmIn)}`, sans, C.muted]);

  const wrapRows = (rows: [string, PdfFont, Color][]) =>
    rows.flatMap(([s, font, color]) => lines(s, font, 9, colW - 2 * 10, 3).map((l) => [l, font, color] as const));
  const cRows = wrapRows(clientRows);
  const vRows = wrapRows(vehicleRows);
  const partyH = 24 + Math.max(cRows.length, vRows.length) * 12 + 6;
  ensure(partyH);
  const party = (x: number, label: string, rows: readonly (readonly [string, PdfFont, Color])[]) => {
    box(x, y, colW, partyH, C.white, C.box);
    text(label.toUpperCase(), x + 10, y - 14, 7, bold, C.muted);
    let ry = y - 28;
    for (const [s, font, color] of rows) {
      text(s, x + 10, ry, 9, font, color);
      ry -= 12;
    }
  };
  party(MARGIN, t('client'), cRows);
  party(MARGIN + colW + 10, t('vehicle'), vRows);
  y -= partyH + 14;

  const section = (title: string) => {
    ensure(40);
    page.drawRectangle({ x: MARGIN, y: y - 16, width: CONTENT, height: 16, color: C.band });
    text(title.toUpperCase(), MARGIN + PAD, y - 11, 7.5, bold, C.ink);
    y -= 22;
  };
  const paragraph = (s: string, size = 9, color: Color = C.ink, font: PdfFont = sans) => {
    for (const l of lines(s, font, size, CONTENT - 2 * PAD)) {
      ensure(size + 4);
      text(l, MARGIN + PAD, y - size, size, font, color);
      y -= size + 3.5;
    }
  };

  // ---------------------------------------------------------------- the intake sheet
  if (data.kind === 'intake' && data.intake) {
    await renderIntake();
  } else {
    renderQuote();
  }

  function renderQuote() {
    // What the client asked for.
    const services = clean(lang === 'en' ? b.services_en : b.services_ro);
    if (services || b.note) {
      section(t('requested'));
      if (services) paragraph(services);
      if (b.note) paragraph(t('clientNote', { note: clean(b.note) }), 8.5, C.muted);
      y -= 6;
    }

    if (data.kind === 'final') {
      // Opened, closed, odometer out, who worked, warranty.
      const facts: [string, string][] = [
        [t('opened'), docDay(lang, b.inspection_started_at ?? b.created_at)],
        [t('closed'), b.done_at ? docDay(lang, b.done_at) : t('none')],
        [t('kmOut'), b.odometer != null ? docKm(lang, b.odometer) : t('none')],
      ];
      factRow(facts);
    }

    const items = docLines(data);
    const labor = items.filter((i) => i.kind === 'labor');
    const parts = items.filter((i) => i.kind === 'part');
    const other = items.filter((i) => i.kind === null);
    if (labor.length) table(t('labor'), labor, 'labor');
    if (parts.length) table(t('parts'), parts, 'part');
    if (other.length) table(t('lines'), other, 'other');

    totalsBlock();

    // Duration, notes, warranty, who did the work.
    const info: [string, string][] = [];
    if (q?.est_hours) info.push([t('term'), docDuration(lang, q.est_hours)]);
    if (data.kind === 'final') {
      if (b.work) info.push([t('workDone'), clean(b.work)]);
      if (b.work_by) info.push([t('workBy'), clean(b.work_by)]);
      if (b.checked_by) info.push([t('checkedBy'), clean(b.checked_by)]);
      info.push([
        t('warranty'),
        b.warranty_months && b.warranty_until
          ? t('warrantyValue', { months: docMonths(lang, b.warranty_months), until: docDay(lang, b.warranty_until) })
          : t('noWarranty'),
      ]);
    }
    if (q?.note) info.push([t('note'), clean(q.note)]);
    for (const [label, value] of info) labelled(label, value);

    if (q?.terms) {
      y -= 4;
      section(t('terms'));
      paragraph(clean(q.terms), 8, C.muted);
    }
  }

  function factRow(facts: [string, string][]) {
    const gap = 8;
    const w = (CONTENT - gap * (facts.length - 1)) / facts.length;
    ensure(44);
    facts.forEach(([label, value], i) => {
      const x = MARGIN + i * (w + gap);
      box(x, y, w, 38, C.white, C.box);
      text(label.toUpperCase(), x + 10, y - 13, 6.5, bold, C.muted);
      const v = clampLines([clean(value)], 1, bold, 10, w - 20)[0] ?? '';
      text(v, x + 10, y - 28, 10, bold, C.ink);
    });
    y -= 38 + 12;
  }

  function labelled(label: string, value: string) {
    const labelW = 190;
    const head = lines(label, bold, 8.5, labelW - 12, 2);
    const body = lines(value, sans, 9, CONTENT - labelW - PAD);
    ensure(12 * Math.max(head.length, Math.min(body.length, 3)) + 4);
    const top = y;
    head.forEach((l, i) => text(l, MARGIN + PAD, top - 9 - i * 11, 8.5, bold, C.muted));
    for (const l of body) {
      ensure(12);
      text(l, MARGIN + labelW, y - 9, 9, sans, C.ink);
      y -= 12;
    }
    y = Math.min(y, top - head.length * 11 - 1) - 3;
  }

  function table(title: string, rows: JobDocItem[], kind: 'labor' | 'part' | 'other') {
    section(title);
    // Column right edges (amounts right-aligned) and the name column's width.
    const valueR = MARGIN + CONTENT - PAD;
    const unitR = valueR - 82;
    const qtyR = unitR - 78;
    const producerX = kind === 'part' ? qtyR - 46 - 92 : 0;
    const nameW =
      kind === 'part' ? producerX - MARGIN - 2 * PAD : kind === 'labor' ? qtyR - 46 - MARGIN - PAD : valueR - 90 - MARGIN;
    const head = () => {
      const base = y - 9;
      text(kind === 'labor' ? t('colOperation') : t('colName'), MARGIN + PAD, base, 7.5, bold, C.muted);
      if (kind === 'part') text(t('colProducer'), producerX, base, 7.5, bold, C.muted);
      if (kind !== 'other') {
        right(kind === 'labor' ? t('colHours') : t('colQty'), qtyR, base, 7.5, bold, C.muted);
        right(kind === 'labor' ? t('colRate') : t('colUnit'), unitR, base, 7.5, bold, C.muted);
      }
      right(t('colValue'), valueR, base, 7.5, bold, C.muted);
      y -= 14;
      rule();
    };
    ensure(14 + 22);
    head();
    for (const item of rows) {
      const counts = lineCounts(data, item);
      const decided = q && q.status !== 'sent';
      const notes: string[] = [];
      if (item.variant === 'original') notes.push(t('original'));
      if (item.variant === 'alternative') notes.push(item.option_group != null ? `${t('alternative')} · ${t('orAlternative')}` : t('alternative'));
      if (data.kind === 'quote' && decided && item.approved === false) notes.push(item.option_group != null ? t('notChosen') : t('refused'));
      const nameLines = lines(item.name, sans, 9, nameW, 3);
      const noteLines = notes.length ? lines(notes.join(' · '), sans, 7.5, nameW, 2) : [];
      const h = nameLines.length * 11.5 + noteLines.length * 10 + 7;
      if (y - h < BOTTOM) {
        newPage();
        section(title);
        head();
      }
      const color = counts || !decided ? C.ink : C.faint;
      let ny = y - 12;
      for (const l of nameLines) {
        text(l, MARGIN + PAD, ny, 9, sans, color);
        ny -= 11.5;
      }
      for (const l of noteLines) {
        text(l, MARGIN + PAD, ny + 1.5, 7.5, sans, item.approved === false ? C.amberText : C.muted);
        ny -= 10;
      }
      const top = y - 12;
      if (kind === 'part' && item.brand) {
        const brand = clampLines([clean(item.brand)], 1, sans, 8.5, 88)[0] ?? '';
        text(brand, producerX, top, 8.5, sans, color);
      }
      if (kind !== 'other') {
        if (item.quantity != null && item.unit_price != null) {
          right(docQuantity(lang, item.quantity), qtyR, top, 9, sans, color);
          right(docAmount(lang, item.unit_price), unitR, top, 9, sans, color);
        } else {
          right('—', qtyR, top, 9, sans, C.faint);
          right('—', unitR, top, 9, sans, C.faint);
        }
      }
      right(docAmount(lang, item.price), valueR, top, 9, counts ? bold : sans, color);
      y -= h;
      rule();
    }
    y -= 10;
  }

  /** The totals on the right; the client's agreement beside them, on the left. */
  function totalsBlock() {
    if (!q) return;
    const totals = docTotals(data);
    const rows: [string, string][] = [];
    if (totals.labor > 0 && (totals.parts > 0 || totals.other > 0)) rows.push([t('totalLabor'), docMoney(lang, totals.labor)]);
    if (totals.parts > 0 && (totals.labor > 0 || totals.other > 0)) rows.push([t('totalParts'), docMoney(lang, totals.parts)]);
    if (totals.net !== null && totals.vat !== null && q.vat_rate !== null) {
      rows.push([t('net'), docMoney(lang, totals.net)]);
      rows.push([t('vat', { rate: docQuantity(lang, q.vat_rate) }), docMoney(lang, totals.vat)]);
    }
    const label =
      data.kind === 'final' ? t('totalFinal') : q.status === 'partially_accepted' ? t('totalAccepted') : t('total');
    const w = 240;
    const x = MARGIN + CONTENT - w;
    const totalsH = rows.length * 14 + 28 + (q.vat_rate !== null ? 10 : 0);

    const consent = consentText(lang, data);
    const ok = q.status === 'accepted' || q.status === 'partially_accepted';
    const consentW = CONTENT - w - 18;
    const body = consent ? lines(consent, ok ? bold : sans, 9, consentW - 24, 5) : [];
    const consentH = body.length ? 24 + body.length * 12 : 0;

    ensure(Math.max(totalsH, consentH) + 8);
    const top = y;
    if (body.length) {
      box(MARGIN, top, consentW, consentH, ok ? C.greenTint : C.white, ok ? C.green : C.box);
      text(t('consent').toUpperCase(), MARGIN + 12, top - 14, 7, bold, ok ? C.green : C.muted);
      let cy = top - 28;
      for (const l of body) {
        text(l, MARGIN + 12, cy, 9, ok ? bold : sans, C.ink);
        cy -= 12;
      }
    }
    for (const [l, v] of rows) {
      text(l, x, y - 10, 9, sans, C.muted);
      right(v, MARGIN + CONTENT - PAD, y - 10, 9, sans, C.ink);
      y -= 14;
    }
    y -= 4;
    page.drawLine({ start: { x, y }, end: { x: MARGIN + CONTENT, y }, thickness: 1.4, color: C.ink });
    text(label, x, y - 15, 10.5, bold, C.ink);
    right(docMoney(lang, totals.total), MARGIN + CONTENT - PAD, y - 15, 12, bold, C.ink);
    y -= 24;
    if (q.vat_rate !== null) {
      right(t('pricesVat'), MARGIN + CONTENT - PAD, y - 6, 7, sans, C.faint);
      y -= 10;
    }
    y = Math.min(y, top - consentH) - 12;
  }

  // ---------------------------------------------------------------- intake sheet body
  async function renderIntake() {
    const intake = data.intake!;
    factRow([
      [t('received'), docMoment(lang, intake.created_at)],
      [t('kmIn'), intake.odometer != null ? docKm(lang, intake.odometer) : t('none')],
      [t('fuel'), intake.fuel != null ? fuelText(lang, intake.fuel) : t('none')],
    ]);

    section(t('damage'));
    // The drawing on the left, the numbered list on the right.
    const scale = 0.62;
    const dw = CAR_VIEW.width * scale;
    const dh = CAR_VIEW.height * scale;
    const listX = MARGIN + dw + 40;
    const listW = MARGIN + CONTENT - listX;
    const marks = intake.damages ?? [];
    const markLines = marks.map((m, i) => lines(`${i + 1}. ${damageKindText(lang, m.kind)}${m.note ? ` — ${m.note}` : ''}`, sans, 9, listW, 3));
    const listH = markLines.reduce((s, l) => s + l.length * 12 + 2, 0);
    const blockH = Math.max(dh + 30, listH + 10);
    ensure(blockH);
    const top = y - 14;
    const dx = MARGIN + 18;
    const label = (s: string, yy: number) => text(s, dx + dw / 2 - bold.widthOfTextAtSize(s, 7) / 2, yy, 7, bold, C.muted);
    label(t('front'), top + 4);
    for (const p of CAR_PATHS.wheels) page.drawSvgPath(p, { x: dx, y: top - 6, scale, color: C.car });
    page.drawSvgPath(CAR_PATHS.body, { x: dx, y: top - 6, scale, color: C.white, borderColor: C.car, borderWidth: 1.2 });
    for (const p of CAR_PATHS.details) page.drawSvgPath(p, { x: dx, y: top - 6, scale, borderColor: C.car, borderWidth: 0.9 });
    marks.forEach((m, i) => {
      const cx = dx + m.x * dw;
      const cy = top - 6 - m.y * dh;
      page.drawCircle({ x: cx, y: cy, size: 7, color: C.amber, borderColor: C.ink, borderWidth: 0.6 });
      const n = String(i + 1);
      text(n, cx - bold.widthOfTextAtSize(n, 7) / 2, cy - 2.5, 7, bold, C.ink);
    });
    label(t('rear'), top - 6 - dh - 12);
    let ly = y - 12;
    if (marks.length === 0) text(t('noDamage'), listX, ly, 9, sans, C.muted);
    for (const group of markLines) {
      for (const l of group) {
        text(l, listX, ly, 9, sans, C.ink);
        ly -= 12;
      }
      ly -= 2;
    }
    y -= blockH + 14;

    if (intake.personal_items) {
      section(t('personal'));
      paragraph(clean(intake.personal_items));
      y -= 4;
    }
    if (intake.notes) {
      section(t('observations'));
      paragraph(clean(intake.notes));
      y -= 4;
    }
    const yesNo = (v: boolean | null) => (v === null ? t('notSaid') : v ? t('yes') : t('no'));
    labelled(t('keepParts'), yesNo(intake.keep_parts));
    labelled(t('roadTest'), yesNo(intake.road_test));

    if (photos.length) {
      section(t('photos'));
      const cols = 4;
      const gap = 8;
      const cell = (CONTENT - gap * (cols - 1)) / cols;
      await placePhotos(cols, gap, cell, cell * 0.75);
    }
    confirmBox();
  }

  async function placePhotos(cols: number, gap: number, cell: number, cellH: number) {
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i]!;
      let image: PdfImage;
      try {
        image = photo.type === 'png' ? await doc.embedPng(photo.bytes) : await doc.embedJpg(photo.bytes);
      } catch {
        continue;
      }
      if (i % cols === 0) {
        ensure(cellH + gap);
        if (i > 0) y -= cellH + gap;
      }
      const x = MARGIN + (i % cols) * (cell + gap);
      const ratio = Math.min(cell / image.width, cellH / image.height);
      const w = image.width * ratio;
      const h = image.height * ratio;
      page.drawRectangle({ x, y: y - cellH, width: cell, height: cellH, color: C.band });
      page.drawImage(image, { x: x + (cell - w) / 2, y: y - cellH + (cellH - h) / 2, width: w, height: h });
    }
    y -= cellH + 14;
  }

  function confirmBox() {
    const intake = data.intake!;
    const ok = !!intake.confirmed_at;
    const s = ok ? t('intakeConfirmed', { when: docMoment(lang, intake.confirmed_at!) }) : t('intakeWaiting');
    const body = lines(s, sans, 9, CONTENT - 24, 3);
    const h = 22 + body.length * 12 + 4;
    y -= 6;
    ensure(h);
    box(MARGIN, y, CONTENT, h, ok ? C.greenTint : C.white, ok ? C.green : C.box);
    text(t('consent').toUpperCase(), MARGIN + 12, y - 14, 7, bold, ok ? C.green : C.muted);
    let cy = y - 28;
    for (const l of body) {
      text(l, MARGIN + 12, cy, 9, ok ? bold : sans, C.ink);
      cy -= 12;
    }
    y -= h + 8;
  }

  // ---------------------------------------------------------------- footer (every page)
  const pages = doc.getPages();
  const footer = clean(t('footer', { ref: b.ref }));
  pages.forEach((p, i) => {
    page = p;
    const top = MARGIN + FOOTER_H - 8;
    page.drawLine({ start: { x: MARGIN, y: top }, end: { x: MARGIN + CONTENT, y: top }, thickness: 0.6, color: C.line });
    text(clampLines([footer], 1, sans, 7, CONTENT - 80)[0] ?? '', MARGIN, MARGIN, 7, sans, C.muted);
    right(t('page', { n: i + 1, total: pages.length }), MARGIN + CONTENT, MARGIN, 7, bold, C.muted);
  });

  return doc.save();
}
