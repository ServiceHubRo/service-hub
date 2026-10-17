/**
 * The lines of a quote with variants (T37c): a line may come in two variants, original part and
 * alternative part, stored as two quote_items of one option group. The client (or, for a walk-in,
 * the shop) takes a line in one of its variants or leaves it out; the database refuses both
 * (`quote_variant_both`). Pure logic shared by the client's answer, the shop's answer panel and
 * the read-only lists.
 */

export type QuoteVariant = 'original' | 'alternative';

export interface QuoteVariantFields {
  /** Lines of one group are the variants of one line; null for a plain line. */
  option_group?: number | null;
  variant?: QuoteVariant | null;
  /** The alternative part's brand, when the shop gave one. */
  brand?: string | null;
}

export interface QuoteLineItem extends QuoteVariantFields {
  id: string;
  position: number;
  name: string;
  price: number;
}

export type QuoteLine<T extends QuoteLineItem> =
  | { kind: 'plain'; key: string; item: T }
  | { kind: 'variants'; key: string; original: T; alternative: T };

/** The quote's lines in order: plain lines, and each group as one line with its two variants. */
export function quoteLines<T extends QuoteLineItem>(items: readonly T[]): QuoteLine<T>[] {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const groups = new Map<number, { original?: T; alternative?: T }>();
  for (const item of sorted) {
    if (item.option_group == null || !item.variant) continue;
    const g = groups.get(item.option_group) ?? {};
    g[item.variant] = item;
    groups.set(item.option_group, g);
  }
  const lines: QuoteLine<T>[] = [];
  for (const item of sorted) {
    const g = item.option_group == null ? undefined : groups.get(item.option_group);
    if (g?.original && g.alternative) {
      if (item === g.original)
        lines.push({
          kind: 'variants',
          key: item.id,
          original: g.original,
          alternative: g.alternative,
        });
    } else {
      lines.push({ kind: 'plain', key: item.id, item });
    }
  }
  return lines;
}

/** What the answer starts with: every line, each in its original variant. */
export function initialSelection(items: readonly QuoteLineItem[]): Set<string> {
  const ids = new Set<string>();
  for (const line of quoteLines(items)) ids.add(line.kind === 'plain' ? line.item.id : line.original.id);
  return ids;
}

/** The item taken for a line, or null when the line is left out. */
export function linePick(line: QuoteLine<QuoteLineItem>, selected: ReadonlySet<string>): string | null {
  if (line.kind === 'plain') return selected.has(line.item.id) ? line.item.id : null;
  if (selected.has(line.original.id)) return line.original.id;
  return selected.has(line.alternative.id) ? line.alternative.id : null;
}

/** The selection with this line taken as `id` (one of its items), or left out (null). */
export function withLinePick(selected: ReadonlySet<string>, line: QuoteLine<QuoteLineItem>, id: string | null): Set<string> {
  const next = new Set(selected);
  if (line.kind === 'plain') next.delete(line.item.id);
  else {
    next.delete(line.original.id);
    next.delete(line.alternative.id);
  }
  if (id) next.add(id);
  return next;
}

/**
 * "Accept" when every line is taken (in one of its variants), "Accept selectate" when some are,
 * and a refusal when none are.
 */
export function decisionKind(items: readonly QuoteLineItem[], selected: ReadonlySet<string>): 'all' | 'some' | 'none' {
  const lines = quoteLines(items);
  const taken = lines.filter((l) => linePick(l, selected) !== null).length;
  return taken === 0 ? 'none' : taken === lines.length ? 'all' : 'some';
}
