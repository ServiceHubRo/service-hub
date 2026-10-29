import { formatMoney } from '../i18n/format';
import { plural, translate, type Lang } from '../i18n/translate';
import { quoteLines, type QuoteLine, type QuoteLineItem } from './quoteLines';

/**
 * A quote's lines grouped the way the documents show them (T50): labor, then parts and materials.
 * Lines of older quotes (no kind) stay together under one heading. Pure logic shared by the
 * shop's and the client's views.
 */

export type QuoteSectionKind = 'labor' | 'part' | 'other';

export interface QuoteSection<T extends QuoteLineItem> {
  kind: QuoteSectionKind;
  lines: QuoteLine<T>[];
}

const ORDER: QuoteSectionKind[] = ['labor', 'part', 'other'];

export function quoteSections<T extends QuoteLineItem>(items: readonly T[]): QuoteSection<T>[] {
  const by = new Map<QuoteSectionKind, QuoteLine<T>[]>();
  for (const line of quoteLines(items)) {
    const item = line.kind === 'plain' ? line.item : line.original;
    const kind: QuoteSectionKind = item.kind === 'labor' ? 'labor' : item.kind === 'part' ? 'part' : 'other';
    by.set(kind, [...(by.get(kind) ?? []), line]);
  }
  return ORDER.filter((k) => by.has(k)).map((kind) => ({ kind, lines: by.get(kind)! }));
}

/** Whether the quote says what its lines are (a T50 quote), so headings are worth showing. */
export function hasSections(items: readonly QuoteLineItem[]): boolean {
  return items.some((i) => i.kind === 'labor' || i.kind === 'part');
}

/** `1,5 ore × 181,50 lei` / `4 × 129 lei`; empty for a fixed price. */
export function quantityDetail(lang: Lang, item: QuoteLineItem): string {
  if (item.quantity == null || item.unit_price == null) return '';
  const qty = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'ro-RO', { maximumFractionDigits: 2 }).format(item.quantity);
  return item.kind === 'labor'
    ? translate(lang, 'quote.detail.hours', { hours: qty, rate: formatMoney(lang, item.unit_price) })
    : translate(lang, 'quote.detail.qty', { qty, price: formatMoney(lang, item.unit_price) });
}

/** The VAT inside a total that includes it, in lei (rounded to the ban). */
export function vatOf(total: number, rate: number): number {
  const bani = Math.round(total * 100);
  return (bani - Math.round((bani * 100) / (100 + rate))) / 100;
}

/** The estimated time: `2 ore`, `3 zile` (whole days from 24 hours on). */
export function estimateText(lang: Lang, hours: number): string {
  return hours >= 24 && hours % 24 === 0 ? plural(lang, 'unit.days', hours / 24) : plural(lang, 'unit.hours', hours);
}
