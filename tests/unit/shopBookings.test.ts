import { describe, expect, it } from 'vitest';
import {
  checkDraft,
  convertPriceText,
  convertRows,
  draftTotals,
  GROSS,
  parsePriceBani,
  parseQuantity,
  priceText,
  rowBani,
  type QuoteDraftRow,
} from '../../src/lib/quoteDraft';
import {
  addDays,
  dashboardCounts,
  matchesFilter,
  parseFilter,
  parseTab,
  slotStarted,
  tabList,
  todaySchedule,
  type BookingWhen,
} from '../../src/lib/shopBookings';

const TODAY = '2026-10-14';

function b(status: BookingWhen['status'], date: string, slot = '10:00'): BookingWhen {
  return { status, date, slot };
}

describe('shop bookings: tabs, filters, counters', () => {
  const list: BookingWhen[] = [
    b('pending', TODAY, '09:00'),
    b('pending', addDays(TODAY, 2)),
    b('confirmed', TODAY, '11:00'),
    b('confirmed', TODAY, '08:00'),
    b('in_inspection', TODAY, '09:00'),
    b('quote_sent', addDays(TODAY, -1)),
    b('approved', addDays(TODAY, 6)),
    b('in_progress', addDays(TODAY, 7)),
  ];

  it('adds calendar days across months', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts the six Panou cards', () => {
    expect(dashboardCounts(list, TODAY)).toEqual({
      requests: 2,
      today: 3, // confirmed ×2 + in_inspection; a pending request today is not "scheduled"
      week: 4, // + approved on day 6; day 7 and yesterday are outside
      inspection: 1,
      quote: 1,
      work: 1,
      todayTaken: 4, // capacity line: every active booking today, requests included
    });
  });

  it('filters only the Programate tab', () => {
    expect(matchesFilter(b('pending', TODAY), 'azi', TODAY)).toBe(false);
    expect(matchesFilter(b('quote_sent', TODAY), 'deviz', TODAY)).toBe(true);
    expect(matchesFilter(b('confirmed', addDays(TODAY, 6)), '7zile', TODAY)).toBe(true);
    expect(matchesFilter(b('confirmed', addDays(TODAY, 7)), '7zile', TODAY)).toBe(false);
  });

  it('sorts tabs and today by time, soonest first', () => {
    expect(tabList(list, 'cereri').map((x) => x.date)).toEqual([TODAY, addDays(TODAY, 2)]);
    expect(tabList(list, 'programate')[0]).toEqual(b('quote_sent', addDays(TODAY, -1)));
    expect(todaySchedule(list, TODAY).map((x) => x.slot)).toEqual(['08:00', '09:00', '11:00']);
  });

  it('knows when a slot has started, in Bucharest time', () => {
    const now = new Date('2026-10-14T07:30:00Z'); // 10:30 in Bucharest (UTC+3)
    expect(slotStarted(b('confirmed', TODAY, '10:00'), now)).toBe(true);
    expect(slotStarted(b('confirmed', TODAY, '10:30'), now)).toBe(true);
    expect(slotStarted(b('confirmed', TODAY, '11:00'), now)).toBe(false);
    expect(slotStarted(b('confirmed', addDays(TODAY, -1), '17:00'), now)).toBe(true);
  });

  it('reads the address safely', () => {
    expect(parseTab('programate')).toBe('programate');
    expect(parseTab('altceva')).toBe('cereri');
    expect(parseTab(null)).toBe('cereri');
    expect(parseFilter('lucru')).toBe('lucru');
    expect(parseFilter('x')).toBeNull();
  });
});

describe('quote editor', () => {
  let n = 0;
  const row = (kind: 'labor' | 'part', name: string, qty: string, price: string, extra: Partial<QuoteDraftRow> = {}): QuoteDraftRow => ({
    key: `r${n++}`,
    kind,
    name,
    qty,
    price,
    ...extra,
  });

  it('parses prices the way a Romanian shop types them', () => {
    expect(parsePriceBani('1250')).toBe(125_000);
    expect(parsePriceBani('99,5')).toBe(9_950);
    expect(parsePriceBani('99.50')).toBe(9_950);
    expect(parsePriceBani('1 250')).toBe(125_000);
    expect(parsePriceBani('0')).toBe(0);
    expect(parsePriceBani('1.250')).toBeNull(); // thousands dot: refused, not read as 1,25
    expect(parsePriceBani('12,345')).toBeNull();
    expect(parsePriceBani('-5')).toBeNull();
    expect(parsePriceBani('abc')).toBeNull();
    expect(parsePriceBani('1000000')).toBe(100_000_000);
    expect(parsePriceBani('1000000,01')).toBeNull();
  });

  it('parses hours and quantities', () => {
    expect(parseQuantity('1,5')).toBe(150);
    expect(parseQuantity('0.1')).toBe(10);
    expect(parseQuantity('4')).toBe(400);
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('1,555')).toBeNull();
    expect(parseQuantity('10001')).toBeNull();
  });

  it('adds up the paper quote exactly: hours × rate, quantity × price', () => {
    const rows = [
      row('labor', 'Revizie ulei + filtre', '1,5', '181,50'),
      row('labor', 'Constatare mecanică', '0,1', '181,50'),
      row('labor', 'Diagnoză tester', '0,1', '181,50'),
      row('part', 'Ulei 5L', '1', '623'),
      row('part', 'Ulei 1L', '4', '129'),
      row('part', 'Filtre', '', '705'),
      row('part', 'Materiale', '5', '5'),
    ];
    expect(draftTotals(rows, { net: false, vatRate: 21 })).toEqual({ labor: 30_855, parts: 186_900, total: 217_755, net: 179_963, vat: 37_792 });
    expect(draftTotals(rows, GROSS).net).toBeNull();
  });

  it('adds the VAT to prices typed without it', () => {
    const mode = { net: true, vatRate: 21 };
    expect(rowBani(row('labor', 'Revizie', '1,5', '150'), mode)).toBe(27_225);
    expect(checkDraft([row('labor', 'Revizie', '1,5', '150')], mode).items).toEqual([{ name: 'Revizie', kind: 'labor', qty: 1.5, unit_price: 181.5 }]);
    expect(convertRows([row('part', 'Ulei', '1', '623', { altPrice: '121' })], true, 21, ',')[0]).toMatchObject({ price: '514,88', altPrice: '100' });
    expect(convertPriceText('514,88', false, 21, ',')).toBe('623');
  });

  it('checks rows like the database and ignores empty ones', () => {
    const a = row('part', 'Plăcuțe frână', '1', '280', { brand: 'Brembo' });
    const blank = row('labor', '', '', '');
    const b = row('labor', '  Manoperă ', '', '120,50');
    const c = row('part', 'Disc', '2', '');
    const d = row('labor', '', '', '50');
    const e = row('part', 'Bec', 'x', '10');
    const f = row('part', 'Plăcuțe spate', '1', '300', { part: 'both', brand: 'Bosch', altPrice: '200', altBrand: 'Ferodo' });
    const checked = checkDraft([a, blank, b, c, d, e, f], GROSS);
    expect(checked.items).toEqual([
      { name: 'Plăcuțe frână', kind: 'part', qty: 1, unit_price: 280, brand: 'Brembo' },
      { name: 'Manoperă', kind: 'labor', price: 120.5 },
      { name: 'Plăcuțe spate', kind: 'part', qty: 1, unit_price: 300, brand: 'Bosch', alt: { unit_price: 200, brand: 'Ferodo' } },
    ]);
    expect(checked.errors).toEqual({ [c.key]: 'price_required', [d.key]: 'name_required', [e.key]: 'qty_invalid' });
    const long = row('labor', 'x'.repeat(201), '', '1');
    expect(checkDraft([long], GROSS).errors).toEqual({ [long.key]: 'name_too_long' });
    const dot = row('part', 'Ulei', '1', '1.250');
    expect(checkDraft([dot], GROSS).errors).toEqual({ [dot.key]: 'price_invalid' });
    const high = row('part', 'Motor', '100', '20000');
    expect(checkDraft([high], GROSS).errors).toEqual({ [high.key]: 'line_too_high' });
  });

  it('shows sent prices back in the editor', () => {
    expect(priceText(280, ',')).toBe('280');
    expect(priceText(99.5, ',')).toBe('99,50');
    expect(priceText(0.1, '.')).toBe('0.10');
  });
});
