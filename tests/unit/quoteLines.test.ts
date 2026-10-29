import { describe, expect, it } from 'vitest';
import { checkDraft, draftTotals, GROSS, type QuoteDraftRow } from '../../src/lib/quoteDraft';
import { decisionKind, initialSelection, linePick, quoteLines, withLinePick } from '../../src/lib/quoteLines';

// Plăcuțe in two variants (positions 1–2, group 1), then a plain line.
const items = [
  { id: 'plain', position: 3, name: 'Manoperă', price: 150, option_group: null, variant: null, brand: null },
  { id: 'orig', position: 1, name: 'Plăcuțe', price: 420, option_group: 1, variant: 'original' as const, brand: null },
  { id: 'alt', position: 2, name: 'Plăcuțe', price: 260, option_group: 1, variant: 'alternative' as const, brand: 'Bosch' },
];

describe('quote lines with variants (T37c)', () => {
  it('groups the two variants into one line, in order', () => {
    const lines = quoteLines(items);
    expect(lines.map((l) => l.kind)).toEqual(['variants', 'plain']);
    expect(lines[0]).toMatchObject({ original: { id: 'orig' }, alternative: { id: 'alt' } });
  });

  it('a quote without variants is plain lines, as before', () => {
    const plain = [{ id: 'a', position: 1, name: 'A', price: 1 }, { id: 'b', position: 2, name: 'B', price: 2 }];
    expect(quoteLines(plain).map((l) => l.kind)).toEqual(['plain', 'plain']);
    expect([...initialSelection(plain)]).toEqual(['a', 'b']);
  });

  it('starts with every line, in the original variant', () => {
    expect([...initialSelection(items)].sort()).toEqual(['orig', 'plain']);
  });

  it('picking a variant replaces the other; leaving the line out drops both', () => {
    const line = quoteLines(items)[0]!;
    const alt = withLinePick(initialSelection(items), line, 'alt');
    expect([...alt].sort()).toEqual(['alt', 'plain']);
    expect(linePick(line, alt)).toBe('alt');
    const out = withLinePick(alt, line, null);
    expect([...out]).toEqual(['plain']);
    expect(linePick(line, out)).toBeNull();
  });

  it('"all" when every line is taken in one variant, "some" when one is left out', () => {
    expect(decisionKind(items, new Set(['alt', 'plain']))).toBe('all');
    expect(decisionKind(items, new Set(['plain']))).toBe('some');
    expect(decisionKind(items, new Set())).toBe('none');
  });
});

describe('editor rows: which part a line is (T37c)', () => {
  const row = (name: string, price: string, extra: Partial<QuoteDraftRow> = {}): QuoteDraftRow => ({
    key: name,
    kind: 'part',
    name,
    qty: '',
    price,
    ...extra,
  });

  it('both: sends the alternative with its price and producer; the total counts the original', () => {
    const rows = [
      row('Plăcuțe', '420', { part: 'both', altPrice: '260', altBrand: ' Bosch ' }),
      row('Manoperă', '150', { kind: 'labor' }),
    ];
    expect(checkDraft(rows, GROSS)).toEqual({
      items: [
        { name: 'Plăcuțe', kind: 'part', price: 420, alt: { price: 260, brand: 'Bosch' } },
        { name: 'Manoperă', kind: 'labor', price: 150 },
      ],
      errors: {},
    });
    expect(draftTotals(rows, GROSS).total).toBe(57000);
  });

  it('a single line says it is the original or the alternative part, with its producer', () => {
    expect(
      checkDraft([row('Filtru', '60', { part: 'alternative', brand: 'Mann' }), row('Ulei', '200', { part: 'original' })], GROSS).items,
    ).toEqual([
      { name: 'Filtru', kind: 'part', price: 60, part: 'alternative', brand: 'Mann' },
      { name: 'Ulei', kind: 'part', price: 200, part: 'original' },
    ]);
    expect(checkDraft([row('Filtru', '60', { part: 'none', brand: 'Mann' })], GROSS).items).toEqual([
      { name: 'Filtru', kind: 'part', price: 60, brand: 'Mann' },
    ]);
  });

  it('the producer is optional; the alternative price is not', () => {
    expect(checkDraft([row('Plăcuțe', '420', { part: 'both', altPrice: '260' })], GROSS).items).toEqual([
      { name: 'Plăcuțe', kind: 'part', price: 420, alt: { price: 260 } },
    ]);
    expect(checkDraft([row('Plăcuțe', '420', { part: 'both', altPrice: '' })], GROSS).errors).toEqual({ Plăcuțe: 'alt_price_required' });
    expect(checkDraft([row('Plăcuțe', '420', { part: 'both', altPrice: '1.250' })], GROSS).errors).toEqual({ Plăcuțe: 'alt_price_invalid' });
    expect(checkDraft([row('Plăcuțe', '420', { part: 'alternative', brand: 'b'.repeat(81) })], GROSS).errors).toEqual({
      Plăcuțe: 'brand_too_long',
    });
  });
});
