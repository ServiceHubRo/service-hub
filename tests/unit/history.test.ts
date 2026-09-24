import { describe, expect, it } from 'vitest';
import {
  csvAmount,
  csvField,
  filterHistory,
  historyTotals,
  jobsOf,
  matchesHistory,
  monthsBefore,
  normalizePlate,
  otherVehicles,
  periodStart,
  sameVehicle,
  sumCosts,
  toCsv,
  vehicleKey,
  type HistoryEntry,
  type HistoryStatus,
} from '../../src/lib/history';
import type { BookingStatus } from '../../src/lib/status';

describe('vehicle matching (P16c)', () => {
  it('matches on the plate, ignoring spaces, dashes and case', () => {
    expect(normalizePlate(' bv-12 abc ')).toBe('BV12ABC');
    expect(sameVehicle({ plate: 'BV 12 ABC' }, { plate: 'bv12abc', make: 'Other' })).toBe(true);
    expect(sameVehicle({ plate: 'BV 12 ABC' }, { plate: 'BV 12 ABD' })).toBe(false);
  });

  it('falls back to make + model + year when there is no plate', () => {
    expect(sameVehicle({ make: 'Dacia', model: 'Logan', year: 2015 }, { make: ' dacia', model: 'LOGAN ', year: 2015, plate: '' })).toBe(true);
    expect(sameVehicle({ make: 'Dacia', model: 'Logan', year: 2015 }, { make: 'Dacia', model: 'Logan', year: 2016 })).toBe(false);
    // A plate-less car never takes the jobs of a car that had a plate.
    expect(sameVehicle({ make: 'Dacia', model: 'Logan', year: 2015 }, { make: 'Dacia', model: 'Logan', year: 2015, plate: 'BV 01 XYZ' })).toBe(false);
    expect(vehicleKey({ make: 'VW', model: 'Golf 7', year: null })).toBe('car:vw|golf 7|');
  });

  const job = (id: string, status: BookingStatus, plate: string, doneAt: string | null, cost: number | null = 100) => ({
    id,
    status,
    car_snapshot: { make: 'VW', model: 'Golf', plate },
    date: (doneAt ?? '2026-01-01').slice(0, 10),
    slot: '10:00:00',
    done_at: doneAt,
    cost,
  });

  const bookings = [
    job('a', 'done', 'BV 12 ABC', '2026-03-01T10:00:00Z', 340),
    job('b', 'done', 'BV12ABC', '2026-09-01T10:00:00Z', 250.1),
    job('c', 'quote_refused', 'BV 12 ABC', null),
    job('d', 'done', 'B 99 OLD', '2025-05-01T10:00:00Z'),
    job('e', 'done', 'B-99-OLD', '2025-08-01T10:00:00Z'),
    job('f', 'cancelled', 'CJ 01 NEW', null),
  ];

  it('lists only finished jobs of the car, newest first', () => {
    expect(jobsOf(bookings, { plate: 'bv 12 abc' }).map((b) => b.id)).toEqual(['b', 'a']);
    expect(sumCosts(jobsOf(bookings, { plate: 'BV12ABC' }))).toBe(590.1);
  });

  it('groups finished jobs on cars that are not in the garage', () => {
    const others = otherVehicles(bookings, [{ plate: 'BV 12 ABC' }]);
    expect(others).toHaveLength(1);
    expect(others[0]?.latest.id).toBe('e');
    expect(others[0]?.jobs).toBe(2);
  });

  it('counts money in bani', () => {
    expect(sumCosts([{ cost: 0.1 }, { cost: 0.2 }, { cost: null }])).toBe(0.3);
  });
});

describe('periods (P16b)', () => {
  it('goes back calendar months, clamping the day', () => {
    expect(monthsBefore('2026-09-24', 1)).toBe('2026-08-24');
    expect(monthsBefore('2026-03-31', 1)).toBe('2026-02-28');
    expect(monthsBefore('2026-02-15', 3)).toBe('2025-11-15');
    expect(monthsBefore('2024-05-31', 3)).toBe('2024-02-29');
  });

  it('starts each quick range on the right day', () => {
    expect(periodStart('month', '2026-09-24')).toBe('2026-08-24');
    expect(periodStart('quarter', '2026-09-24')).toBe('2026-06-24');
    expect(periodStart('year', '2026-09-24')).toBe('2026-01-01');
    expect(periodStart('all', '2026-09-24')).toBeNull();
  });
});

describe('the shop history list', () => {
  const entry = (ref: string, status: HistoryStatus, endedAt: string, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
    ref,
    status,
    ended_at: endedAt,
    service_ro: 'Plăcuțe de frână',
    service_en: 'Brake pads',
    client_name: 'Andrei Popescu',
    car_snapshot: { make: 'Volkswagen', model: 'Golf 7', year: 2016, plate: 'BV 12 ABC' },
    odometer: 105400,
    cost: 340,
    ...extra,
  });

  const list = [
    entry('P-1', 'done', '2026-09-20T09:00:00Z'),
    entry('P-2', 'done', '2026-07-01T09:00:00Z', {
      car_snapshot: { make: 'Dacia', model: 'Logan', plate: 'B-99-OLD' },
      client_name: 'Maria Ionescu',
      service_ro: 'Schimb ulei + filtru ulei',
      service_en: 'Oil and filter change',
      cost: 250.5,
      odometer: 98000,
    }),
    entry('P-3', 'quote_refused', '2026-09-10T09:00:00Z', { cost: 100 }),
    entry('P-4', 'expired', '2025-12-31T22:30:00Z', { cost: null }), // 00:30 on 1 Jan 2026 in Bucharest (UTC+2)
    entry('P-5', 'cancelled', '2025-06-01T09:00:00Z', { cost: null }),
    entry('P-6', 'no_show', '2026-09-01T09:00:00Z', { cost: null }),
  ];
  const today = '2026-09-24';
  const refs = (items: HistoryEntry[]) => items.map((e) => e.ref);

  it('searches plate, car, client, service and odometer without diacritics', () => {
    expect(refs(list.filter((e) => matchesHistory(e, 'BV 12')))).toEqual(['P-1', 'P-3', 'P-4', 'P-5', 'P-6']);
    expect(refs(list.filter((e) => matchesHistory(e, 'b99old')))).toEqual(['P-2']);
    expect(refs(list.filter((e) => matchesHistory(e, 'ionescu')))).toEqual(['P-2']);
    expect(refs(list.filter((e) => matchesHistory(e, 'frâne')))).toHaveLength(5);
    expect(refs(list.filter((e) => matchesHistory(e, 'oil')))).toEqual(['P-2']);
    expect(refs(list.filter((e) => matchesHistory(e, 'logan 98000')))).toEqual(['P-2']);
    expect(refs(list.filter((e) => matchesHistory(e, '  ')))).toHaveLength(6);
  });

  it('filters by status chip and period', () => {
    expect(refs(filterHistory(list, { query: '', filter: 'done', period: 'all', today }))).toEqual(['P-1', 'P-2']);
    expect(refs(filterHistory(list, { query: '', filter: 'refused', period: 'all', today }))).toEqual(['P-3', 'P-4']);
    expect(refs(filterHistory(list, { query: '', filter: 'cancelled', period: 'all', today }))).toEqual(['P-5']);
    expect(refs(filterHistory(list, { query: '', filter: 'no_show', period: 'all', today }))).toEqual(['P-6']);
    expect(refs(filterHistory(list, { query: '', filter: 'all', period: 'month', today }))).toEqual(['P-1', 'P-3', 'P-6']);
    expect(refs(filterHistory(list, { query: '', filter: 'all', period: 'quarter', today }))).toEqual(['P-1', 'P-2', 'P-3', 'P-6']);
    // The year is counted in Bucharest: 31 Dec 22:30 UTC is already 1 Jan.
    expect(refs(filterHistory(list, { query: '', filter: 'refused', period: 'year', today }))).toEqual(['P-3', 'P-4']);
    expect(refs(filterHistory(list, { query: 'golf', filter: 'done', period: 'month', today }))).toEqual(['P-1']);
  });

  it('totals only finished jobs', () => {
    expect(historyTotals(list)).toEqual({ jobs: 2, revenue: 590.5 });
    expect(historyTotals([])).toEqual({ jobs: 0, revenue: 0 });
  });
});

describe('CSV export', () => {
  it('writes amounts the way the spreadsheet expects', () => {
    expect(csvAmount(340, ',')).toBe('340');
    expect(csvAmount(340.5, ',')).toBe('340,50');
    expect(csvAmount(1250.05, '.')).toBe('1250.05');
    expect(csvAmount(null, ',')).toBe('');
  });

  it('quotes fields that need it and defuses formulas', () => {
    expect(csvField('Golf 7', ';')).toBe('Golf 7');
    expect(csvField('Ulei; filtru', ';')).toBe('"Ulei; filtru"');
    expect(csvField('Ulei, filtru', ';')).toBe('Ulei, filtru');
    expect(csvField('Zis "urgent"', ',')).toBe('"Zis ""urgent"""');
    expect(csvField('rând 1\nrând 2', ';')).toBe('"rând 1\nrând 2"');
    expect(csvField('=HYPERLINK("x")', ';')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('+40723', ';')).toBe("'+40723");
  });

  it('starts with a byte-order mark and ends every row with CRLF', () => {
    expect(toCsv([['Data', 'Număr'], ['2026-09-24', 'BV 12 ABC']], ';')).toBe('﻿Data;Număr\r\n2026-09-24;BV 12 ABC\r\n');
  });
});
