/**
 * The quote editor's lines (T50; before it FR §4.2, P15, T37c): labor (hours × hourly rate) and
 * parts (quantity × unit price, producer, original or alternative part). A line without hours or
 * quantity has a fixed price. Checked before sending with the same rules as the database
 * (`clean_quote_lines`): a name up to 200 characters, prices 0–1 000 000 lei with at most 2
 * decimals, quantities 0,01–10 000 with at most 2 decimals; empty lines are ignored; the total
 * must be above zero.
 *
 * Prices may be typed with or without VAT (a VAT payer's choice); what is sent always includes it,
 * since that is what the client pays. Amounts are counted in bani (integers), so 0,1 + 0,2 is
 * exactly 0,30 and a line's total is rounded once, like the database's round(qty × unit, 2).
 */

/** Which part a line is: not said, original, alternative, or both for the client to pick. */
export type QuotePartKind = 'none' | 'original' | 'alternative' | 'both';

export type QuoteLineKind = 'labor' | 'part';

export interface QuoteDraftRow {
  /** Local key for React and focus; never sent. */
  key: string;
  kind: QuoteLineKind;
  name: string;
  /** Hours (labor) or quantity (part); empty = a fixed price. */
  qty: string;
  /** The rate per hour or the price per piece; the whole price when `qty` is empty. */
  price: string;
  /** Parts only. */
  part?: QuotePartKind;
  /** The producer (parts); the original's when the line offers both. */
  brand?: string;
  /** The alternative part's unit price and producer, when the line offers both. */
  altPrice?: string;
  altBrand?: string;
}

export type QuoteRowError =
  | 'name_required'
  | 'name_too_long'
  | 'qty_invalid'
  | 'price_required'
  | 'price_invalid'
  | 'line_too_high'
  | 'alt_price_required'
  | 'alt_price_invalid'
  | 'brand_too_long';

export const QUOTE_NAME_MAX = 200;
export const QUOTE_BRAND_MAX = 80;
export const QUOTE_ROWS_MAX = 50;
const PRICE_MAX_BANI = 1_000_000 * 100;
const QTY_MAX = 10_000 * 100;

/** How the prices are typed: with VAT (what the client pays) or without, and the rate. */
export interface PriceMode {
  /** True when the shop types prices without VAT. */
  net: boolean;
  /** The VAT rate of a quote sent now; null when the shop is not a VAT payer. */
  vatRate: number | null;
}

export const GROSS: PriceMode = { net: false, vatRate: null };

/**
 * Lei typed as `1250`, `99,5`, `99.50` or `1 250` → bani; null when it is not a price. A dot or
 * comma is a decimal separator only when 1–2 digits follow it: `1.250` (a Romanian thousands dot)
 * is refused rather than read as 1,25 lei.
 */
export function parsePriceBani(text: string): number | null {
  const s = text.replace(/\s/g, '');
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const bani = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bani <= PRICE_MAX_BANI ? bani : null;
}

/** Hours or a quantity typed as `1,5`, `0.25`, `4` → hundredths; null when it is not one (0 is not). */
export function parseQuantity(text: string): number | null {
  const s = text.replace(/\s/g, '');
  const m = /^(\d{1,5})(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return n > 0 && n <= QTY_MAX ? n : null;
}

/** A net price in bani with the VAT added, rounded to the ban. */
export function withVat(bani: number, rate: number): number {
  return Math.round((bani * (100 + rate)) / 100);
}

/** A gross price in bani without its VAT, rounded to the ban. */
export function withoutVat(bani: number, rate: number): number {
  return Math.round((bani * 100) / (100 + rate));
}

/** A typed price as the client pays it (with VAT), in bani; null when it is not a price. */
function grossBani(text: string, mode: PriceMode): number | null {
  const bani = parsePriceBani(text);
  if (bani === null) return null;
  return mode.net && mode.vatRate !== null ? withVat(bani, mode.vatRate) : bani;
}

/** A line's amount from its quantity (hundredths) and unit price (bani), as the database rounds it. */
export function lineBani(qtyHundredths: number | null, unitBani: number): number {
  return qtyHundredths === null ? unitBani : Math.round((qtyHundredths * unitBani) / 100);
}

function isBlank(row: QuoteDraftRow): boolean {
  return (
    row.name.trim() === '' &&
    row.price.trim() === '' &&
    !row.altPrice?.trim() &&
    !row.brand?.trim() &&
    !row.altBrand?.trim()
  );
}

/** The amount a row adds to the total (with VAT, in bani); rows not (yet) valid count as 0. */
export function rowBani(row: QuoteDraftRow, mode: PriceMode): number {
  const unit = grossBani(row.price, mode);
  if (unit === null) return 0;
  const qty = row.qty.trim() === '' ? null : parseQuantity(row.qty);
  if (row.qty.trim() !== '' && qty === null) return 0;
  return lineBani(qty, unit);
}

export interface DraftTotals {
  labor: number;
  parts: number;
  total: number;
  /** Null when the shop is not a VAT payer. */
  net: number | null;
  vat: number | null;
}

/** Live totals in bani (with VAT): labor, parts, and the VAT worked out of the total. */
export function draftTotals(rows: readonly QuoteDraftRow[], mode: PriceMode): DraftTotals {
  let labor = 0;
  let parts = 0;
  for (const r of rows) {
    if (r.kind === 'labor') labor += rowBani(r, mode);
    else parts += rowBani(r, mode);
  }
  const total = labor + parts;
  const net = mode.vatRate === null ? null : withoutVat(total, mode.vatRate);
  return { labor, parts, total, net, vat: net === null ? null : total - net };
}

/** A line as send_quote / replace_quote take it (prices with VAT, in lei). */
export interface QuoteLineInput {
  name: string;
  kind: QuoteLineKind;
  qty?: number;
  unit_price?: number;
  price?: number;
  part?: 'original' | 'alternative';
  brand?: string;
  alt?: { unit_price?: number; price?: number; brand?: string };
}

export interface CheckedDraft {
  items: QuoteLineInput[];
  /** By row key. */
  errors: Record<string, QuoteRowError>;
}

export function checkDraft(rows: readonly QuoteDraftRow[], mode: PriceMode): CheckedDraft {
  const items: QuoteLineInput[] = [];
  const errors: Record<string, QuoteRowError> = {};
  for (const row of rows) {
    if (isBlank(row)) continue;
    const name = row.name.trim();
    const hasQty = row.qty.trim() !== '';
    const qty = hasQty ? parseQuantity(row.qty) : null;
    const unit = grossBani(row.price, mode);
    const part = row.kind === 'part' ? (row.part ?? 'none') : 'none';
    const brand = row.kind === 'part' ? (row.brand ?? '').trim() : '';
    const altBrand = part === 'both' ? (row.altBrand ?? '').trim() : '';
    const altUnit = part === 'both' ? grossBani(row.altPrice ?? '', mode) : null;
    let error: QuoteRowError | null = null;
    if (name === '') error = 'name_required';
    else if (name.length > QUOTE_NAME_MAX) error = 'name_too_long';
    else if (hasQty && qty === null) error = 'qty_invalid';
    else if (row.price.trim() === '') error = 'price_required';
    else if (unit === null || unit > PRICE_MAX_BANI) error = 'price_invalid';
    else if (lineBani(qty, unit) > PRICE_MAX_BANI) error = 'line_too_high';
    else if (brand.length > QUOTE_BRAND_MAX || altBrand.length > QUOTE_BRAND_MAX) error = 'brand_too_long';
    else if (part === 'both' && !row.altPrice?.trim()) error = 'alt_price_required';
    else if (part === 'both' && (altUnit === null || altUnit > PRICE_MAX_BANI)) error = 'alt_price_invalid';
    else if (part === 'both' && lineBani(qty, altUnit!) > PRICE_MAX_BANI) error = 'line_too_high';
    if (error) {
      errors[row.key] = error;
      continue;
    }
    const item: QuoteLineInput = { name, kind: row.kind };
    if (qty !== null) {
      item.qty = qty / 100;
      item.unit_price = unit! / 100;
    } else {
      item.price = unit! / 100;
    }
    if (brand) item.brand = brand;
    if (part === 'original' || part === 'alternative') item.part = part;
    if (part === 'both') {
      item.alt = qty !== null ? { unit_price: altUnit! / 100 } : { price: altUnit! / 100 };
      if (altBrand) item.alt.brand = altBrand;
    }
    items.push(item);
  }
  return { items, errors };
}

/** Prices as the editor shows them: `99,5` → `99,50` (RO) / `99.50`; whole lei without decimals. */
export function priceText(lei: number, decimal: ',' | '.'): string {
  const bani = Math.round(lei * 100);
  const whole = Math.floor(bani / 100);
  const cents = bani % 100;
  return cents === 0 ? String(whole) : `${whole}${decimal}${String(cents).padStart(2, '0')}`;
}

/** Hours or a quantity as the editor shows them: `1,5`, `4`. */
export function quantityText(n: number, decimal: ',' | '.'): string {
  const h = Math.round(n * 100);
  const whole = Math.floor(h / 100);
  const frac = h % 100;
  if (frac === 0) return String(whole);
  return `${whole}${decimal}${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** A price shown in the other mode: with VAT ↔ without. Text that is not a price stays as typed. */
export function convertPriceText(text: string, toNet: boolean, rate: number, decimal: ',' | '.'): string {
  const bani = parsePriceBani(text);
  if (bani === null) return text;
  return priceText((toNet ? withoutVat(bani, rate) : withVat(bani, rate)) / 100, decimal);
}

/** Every price of the rows in the other mode (the switch between "cu TVA" and "fără TVA"). */
export function convertRows(rows: readonly QuoteDraftRow[], toNet: boolean, rate: number, decimal: ',' | '.'): QuoteDraftRow[] {
  return rows.map((r) => ({
    ...r,
    price: convertPriceText(r.price, toNet, rate, decimal),
    altPrice: r.altPrice === undefined ? undefined : convertPriceText(r.altPrice, toNet, rate, decimal),
  }));
}
