/**
 * The quote composer's rows (FR §4.2, P15): what the shop typed, checked before sending with the
 * same rules as the database (`clean_quote_lines`): a name up to 200 characters and a price from 0
 * to 1 000 000 lei with at most 2 decimals; empty rows are ignored; the total must be above zero.
 * A row may carry an alternative part (T37c): its price, same rules, and an optional brand up to
 * 80 characters; the total counts the original part.
 * Amounts are counted in bani (integers), so 0,1 + 0,2 is exactly 0,30.
 */

export interface QuoteDraftRow {
  /** Local key for React and focus; never sent. */
  key: string;
  name: string;
  /** The original part's price when the row has an alternative. */
  price: string;
  /** The alternative part, when the shop added one. */
  alt?: { price: string; brand: string } | null;
}

export type QuoteRowError =
  | 'name_required'
  | 'name_too_long'
  | 'price_required'
  | 'price_invalid'
  | 'alt_price_required'
  | 'alt_price_invalid'
  | 'brand_too_long';

export const QUOTE_NAME_MAX = 200;
export const QUOTE_BRAND_MAX = 80;
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
  return row.name.trim() === '' && row.price.trim() === '' && !row.alt?.price.trim() && !row.alt?.brand.trim();
}

/** Live total in bani; rows whose price is not (yet) valid count as 0. */
export function draftTotalBani(rows: readonly QuoteDraftRow[]): number {
  return rows.reduce((sum, r) => sum + (parsePriceBani(r.price) ?? 0), 0);
}

export interface CheckedDraft {
  /** Ready for send_quote / replace_quote (lei). */
  items: {
    name: string;
    price: number;
    alt?: { price: number; brand?: string };
  }[];
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
    else if (!row.alt) items.push({ name, price: bani / 100 });
    else {
      const altBani = parsePriceBani(row.alt.price);
      const brand = row.alt.brand.trim();
      if (row.alt.price.trim() === '') errors[row.key] = 'alt_price_required';
      else if (altBani === null) errors[row.key] = 'alt_price_invalid';
      else if (brand.length > QUOTE_BRAND_MAX) errors[row.key] = 'brand_too_long';
      else
        items.push({
          name,
          price: bani / 100,
          alt: brand ? { price: altBani / 100, brand } : { price: altBani / 100 },
        });
    }
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
