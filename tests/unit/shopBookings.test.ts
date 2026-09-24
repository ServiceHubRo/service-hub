import { describe, expect, it } from 'vitest';
import { checkDraft, draftTotalBani, parsePriceBani, priceText, type QuoteDraftRow } from '../../src/lib/quoteDraft';
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

describe('quote composer', () => {
  const row = (name: string, price: string, key = name || price): QuoteDraftRow => ({ key, name, price });

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

  it('adds up exactly in bani', () => {
    expect(draftTotalBani([row('a', '0,1'), row('b', '0,2'), row('c', 'x')])).toBe(30);
  });

  it('checks rows like the database and ignores empty ones', () => {
    const checked = checkDraft([row('Plăcuțe frână', '280'), row('', ''), row('  Manoperă ', '120,50'), row('Disc', ''), row('', '50')]);
    expect(checked.items).toEqual([
      { name: 'Plăcuțe frână', price: 280 },
      { name: 'Manoperă', price: 120.5 },
    ]);
    expect(checked.errors).toEqual({ Disc: 'price_required', '50': 'name_required' });
    expect(checkDraft([row('x'.repeat(201), '1')]).errors).toEqual({ ['x'.repeat(201)]: 'name_too_long' });
    expect(checkDraft([row('Ulei', '1.250')]).errors).toEqual({ Ulei: 'price_invalid' });
  });

  it('shows sent prices back in the composer', () => {
    expect(priceText(280, ',')).toBe('280');
    expect(priceText(99.5, ',')).toBe('99,50');
    expect(priceText(0.1, '.')).toBe('0.10');
  });
});
