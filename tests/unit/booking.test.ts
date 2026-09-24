import { describe, expect, it } from 'vitest';
import { splitBookings, type ClientBooking } from '../../src/data/bookings';
import { canRetryRpc, RpcError, type AvailabilityDay } from '../../src/data/rpc';
import { daysFromToday, formatDayTile } from '../../src/i18n/format';
import { plural } from '../../src/i18n/translate';
import { BOOKING_DAYS_SHOWN, bookingDays } from '../../src/lib/bookingDays';
import { isValidCarYear } from '../../src/lib/car';
import { expiryAlerts, urgencyOf } from '../../src/lib/expiry';

// 2026-10-14 09:30 in Bucharest (UTC+3 in October).
const NOW = new Date('2026-10-14T06:30:00Z');

function day(date: string, reason: AvailabilityDay['reason'] = null, places = 3): AvailabilityDay {
  return { date, reason, bookable: reason === null, places_left: reason === 'full' ? 0 : places };
}

describe('booking calendar days (ARCHITECTURE §4)', () => {
  it('skips closed days, closures and days past the horizon; keeps full days (dimmed)', () => {
    const days = [
      day('2026-10-14'),
      day('2026-10-15', 'full'),
      day('2026-10-16', 'closed'),
      day('2026-10-17', 'closure'),
      day('2026-10-18'),
      day('2026-10-19', 'too_far'),
    ];
    expect(bookingDays(days, 2, NOW).map((d) => d.date)).toEqual(['2026-10-14', '2026-10-15', '2026-10-18']);
  });

  it('drops a day with no time left because of the clock or the notice, not one where every time is taken', () => {
    const days = [day('2026-10-14', 'no_slots'), day('2026-10-15', 'no_slots'), day('2026-10-16', 'no_slots'), day('2026-10-17')];
    // 48 h of notice from Wed 09:30 reaches Fri 09:30: Wed and Thu are out of reach, Fri is inside the notice.
    expect(bookingDays(days, 48, NOW).map((d) => d.date)).toEqual(['2026-10-17']);
    // 2 h of notice: today has no time left (clock) → hidden; tomorrow has none because all are taken → full.
    expect(bookingDays(days, 2, NOW).map((d) => d.date)).toEqual(['2026-10-15', '2026-10-16', '2026-10-17']);
  });

  it('never shows a past day and stops at 12', () => {
    const many = Array.from({ length: 30 }, (_, i) => day(`2026-10-${String(13 + (i % 18)).padStart(2, '0')}`));
    const shown = bookingDays([day('2026-10-13'), ...many.slice(1, 20)], 2, NOW);
    expect(shown.every((d) => d.date >= '2026-10-14')).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(BOOKING_DAYS_SHOWN);
  });

  it('day tiles and places read naturally in both languages', () => {
    expect(formatDayTile('ro', '2026-10-14')).toEqual({ weekday: 'Mie', day: '14', month: 'oct' });
    expect(formatDayTile('en', '2026-10-14')).toEqual({ weekday: 'Wed', day: '14', month: 'Oct' });
    expect(plural('ro', 'unit.places', 1)).toBe('1 loc');
    expect(plural('ro', 'unit.places', 3)).toBe('3 locuri');
    expect(plural('ro', 'unit.places', 20)).toBe('20 de locuri');
    expect(plural('en', 'unit.places', 1)).toBe('1 spot');
    expect(plural('en', 'unit.places', 3)).toBe('3 spots');
  });
});

describe('document expiry (P7)', () => {
  it('counts Bucharest calendar days, whatever the device zone', () => {
    // 23:30 UTC on the 13th is already the 14th in Bucharest.
    const lateEvening = new Date('2026-10-13T23:30:00Z');
    expect(daysFromToday('2026-10-14', lateEvening)).toBe(0);
    expect(daysFromToday('2026-10-26', NOW)).toBe(12);
    expect(daysFromToday('2026-10-11', NOW)).toBe(-3);
  });

  it('muted over 30 days, amber within 30, red on and after the day', () => {
    expect(urgencyOf(31)).toBe('ok');
    expect(urgencyOf(30)).toBe('soon');
    expect(urgencyOf(1)).toBe('soon');
    expect(urgencyOf(0)).toBe('expired');
    expect(urgencyOf(-5)).toBe('expired');
  });

  it('lists every document within 30 days or past, most urgent first; ignores unset and far dates', () => {
    const cars = [
      { id: 'golf', make: 'Volkswagen', model: 'Golf 7', itp_expiry: '2026-10-26', rca_expiry: '2027-05-01', vignette_expiry: '2026-10-11' },
      { id: 'duster', make: 'Dacia', model: 'Duster', itp_expiry: null, rca_expiry: '2026-11-13', vignette_expiry: null },
      { id: 'none', make: 'Skoda', model: 'Octavia', itp_expiry: null, rca_expiry: null, vignette_expiry: null },
    ];
    const alerts = expiryAlerts(cars, NOW);
    expect(alerts.map((a) => [a.carName, a.doc, a.days, a.urgency])).toEqual([
      ['Golf 7', 'vignette', -3, 'expired'],
      ['Golf 7', 'itp', 12, 'soon'],
      ['Duster', 'rca', 30, 'soon'],
    ]);
    expect(expiryAlerts([cars[2]!], NOW)).toEqual([]);
  });
});

describe('car details', () => {
  it('year: optional, 4 digits, 1900 to next year', () => {
    expect(isValidCarYear('', NOW)).toBe(true);
    expect(isValidCarYear('2016', NOW)).toBe(true);
    expect(isValidCarYear('2027', NOW)).toBe(true);
    expect(isValidCarYear('2028', NOW)).toBe(false);
    expect(isValidCarYear('1899', NOW)).toBe(false);
    expect(isValidCarYear('16', NOW)).toBe(false);
  });
});

describe('client bookings list (FR §3.5)', () => {
  const b = (id: string, status: ClientBooking['status'], date: string, slot = '10:00:00'): ClientBooking => ({
    id,
    ref: id,
    status,
    date,
    slot,
    note: null,
    car_snapshot: {},
    created_at: '2026-10-01T00:00:00Z',
    shop_id: 's',
    service_id: 'ulei',
    shop: null,
    service: null,
  });

  it('active first, soonest first; then the ended ones, newest first', () => {
    const { active, past } = splitBookings([
      b('done-old', 'done', '2026-08-01'),
      b('pending-late', 'pending', '2026-10-20'),
      b('cancelled', 'cancelled', '2026-10-10'),
      b('confirmed-soon', 'confirmed', '2026-10-16', '09:00:00'),
      b('inspection', 'in_inspection', '2026-10-16', '08:00:00'),
    ]);
    expect(active.map((x) => x.id)).toEqual(['inspection', 'confirmed-soon', 'pending-late']);
    expect(past.map((x) => x.id)).toEqual(['cancelled', 'done-old']);
  });
});

describe('retrying a write', () => {
  it('only when the answer never came, never after a business refusal', () => {
    expect(canRetryRpc(new RpcError('network'))).toBe(true);
    expect(canRetryRpc(new RpcError('unknown'))).toBe(true);
    expect(canRetryRpc(new RpcError('limit_daily'))).toBe(false);
    expect(canRetryRpc(new RpcError('day_full'))).toBe(false);
  });
});
