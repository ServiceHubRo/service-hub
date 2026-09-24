/**
 * The quote composer's rows (FR §4.2, P15): what the shop typed, checked before sending with the
 * same rules as the database (`clean_quote_items`): a name up to 200 characters and a price from 0
 * to 1 000 000 lei with at most 2 decimals; empty rows are ignored; the total must be above zero.
 * Amounts are counted in bani (integers), so 0,1 + 0,2 is exactly 0,30.
 */

export interface QuoteDraftRow {
  /** Local key for React and focus; never sent. */
  key: string;
  name: string;
  price: string;
}

export type QuoteRowError = 'name_required' | 'name_too_long' | 'price_required' | 'price_invalid';

export const QUOTE_NAME_MAX = 200;
export const QUOTE_ROWS_MAX = 50;
const PRICE_MAX_BANI = 1_000_000 * 100;

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

function isBlank(row: QuoteDraftRow): boolean {
  return row.name.trim() === '' && row.price.trim() === '';
}

/** Live total in bani; rows whose price is not (yet) valid count as 0. */
export function draftTotalBani(rows: readonly QuoteDraftRow[]): number {
  return rows.reduce((sum, r) => sum + (parsePriceBani(r.price) ?? 0), 0);
}

export interface CheckedDraft {
  /** Ready for send_quote / replace_quote (lei). */
  items: { name: string; price: number }[];
  /** By row key. */
  errors: Record<string, QuoteRowError>;
}

export function checkDraft(rows: readonly QuoteDraftRow[]): CheckedDraft {
  const items: CheckedDraft['items'] = [];
  const errors: Record<string, QuoteRowError> = {};
  for (const row of rows) {
    if (isBlank(row)) continue;
    const name = row.name.trim();
    const bani = parsePriceBani(row.price);
    if (name === '') errors[row.key] = 'name_required';
    else if (name.length > QUOTE_NAME_MAX) errors[row.key] = 'name_too_long';
    else if (row.price.trim() === '') errors[row.key] = 'price_required';
    else if (bani === null) errors[row.key] = 'price_invalid';
    else items.push({ name, price: bani / 100 });
  }
  return { items, errors };
}

/** Prices as the composer shows them when a sent quote is edited: `99,5` → `99,50` (RO) / `99.50`. */
export function priceText(lei: number, decimal: ',' | '.'): string {
  const bani = Math.round(lei * 100);
  const whole = Math.floor(bani / 100);
  const cents = bani % 100;
  return cents === 0 ? String(whole) : `${whole}${decimal}${String(cents).padStart(2, '0')}`;
}
