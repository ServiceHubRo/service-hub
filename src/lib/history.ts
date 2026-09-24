import { ymdInBucharest } from '../i18n/format';
import { matchesWords, searchWords } from './text';
import type { BookingStatus } from './status';

/**
 * Repair history (FR §3.6, §4.3, P16b, P16c): pure logic for the shop's Istoric (search, status and
 * period filters, totals, the CSV export) and for the client's vehicle history (which bookings
 * belong to which car). The screens only call these.
 */

// ------------------------------------------------------------------ vehicles (client)

/** What a booking remembers of the car, or what the garage knows of it. */
export interface VehicleFields {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  plate?: string | null;
}

/** `bv-12 abc` → `BV12ABC`: upper-case, letters and digits only. */
export function normalizePlate(plate: string | null | undefined): string {
  return (plate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function word(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Which car a booking was for (P16c): the license plate without spaces or case; for a car without
 * a plate, make + model + year. Bookings keep a snapshot of the car, so this still works after the
 * car is edited or deleted from the garage. Deliberately simple, and right in practice.
 */
export function vehicleKey(v: VehicleFields): string {
  const plate = normalizePlate(v.plate);
  return plate ? `plate:${plate}` : `car:${word(v.make)}|${word(v.model)}|${v.year ?? ''}`;
}

export function sameVehicle(a: VehicleFields, b: VehicleFields): boolean {
  return vehicleKey(a) === vehicleKey(b);
}

interface VehicleJob {
  status: BookingStatus;
  car_snapshot: VehicleFields;
  date: string;
  slot: string;
  done_at: string | null;
  cost: number | null;
}

/** When a finished job is dated: the day it was finished, else the day it was booked for. */
export function jobDay(b: { date: string; done_at: string | null }): string {
  return b.done_at ? ymdInBucharest(new Date(b.done_at)) : b.date;
}

function newestFirst<T extends { date: string; slot: string; done_at: string | null }>(a: T, b: T): number {
  return (b.done_at ?? `${b.date} ${b.slot}`).localeCompare(a.done_at ?? `${a.date} ${a.slot}`);
}

/** The finished jobs on one car, newest first. Only `done` counts as history. */
export function jobsOf<T extends VehicleJob>(bookings: readonly T[], vehicle: VehicleFields): T[] {
  const key = vehicleKey(vehicle);
  return bookings.filter((b) => b.status === 'done' && vehicleKey(b.car_snapshot) === key).sort(newestFirst);
}

/** Sum of amounts, counted in bani so 0,10 + 0,20 stays 0,30. */
export function sumCosts(items: readonly { cost: number | null }[]): number {
  return items.reduce((sum, b) => sum + Math.round((b.cost ?? 0) * 100), 0) / 100;
}

/**
 * Cars that have finished jobs but are not (or no longer) in the garage — a car deleted from the
 * garage, or booked without saving it. Each is shown by its newest job.
 */
export function otherVehicles<T extends VehicleJob>(bookings: readonly T[], garage: readonly VehicleFields[]): { latest: T; jobs: number }[] {
  const known = new Set(garage.map(vehicleKey));
  const groups = new Map<string, { latest: T; jobs: number }>();
  for (const b of [...bookings].sort(newestFirst)) {
    if (b.status !== 'done') continue;
    const key = vehicleKey(b.car_snapshot);
    if (known.has(key)) continue;
    const group = groups.get(key);
    if (group) group.jobs += 1;
    else groups.set(key, { latest: b, jobs: 1 });
  }
  return [...groups.values()];
}

// ------------------------------------------------------------------ the shop's Istoric

export type HistoryStatus = Extract<BookingStatus, 'done' | 'quote_refused' | 'expired' | 'cancelled' | 'no_show'>;

/** The status chips (P16b), plus no-shows; refused and expired quotes share one chip. */
export type HistoryFilter = 'all' | 'done' | 'refused' | 'cancelled' | 'no_show';
export const HISTORY_FILTERS: readonly HistoryFilter[] = ['all', 'done', 'refused', 'cancelled', 'no_show'];

const FILTER_STATUSES: Record<Exclude<HistoryFilter, 'all'>, readonly HistoryStatus[]> = {
  done: ['done'],
  refused: ['quote_refused', 'expired'],
  cancelled: ['cancelled'],
  no_show: ['no_show'],
};

/** Quick date ranges (P16b); "Tot" is the default. */
export type HistoryPeriod = 'month' | 'quarter' | 'year' | 'all';
export const HISTORY_PERIODS: readonly HistoryPeriod[] = ['month', 'quarter', 'year', 'all'];

export function isHistoryFilter(value: string | null): value is HistoryFilter {
  return value !== null && (HISTORY_FILTERS as readonly string[]).includes(value);
}

export function isHistoryPeriod(value: string | null): value is HistoryPeriod {
  return value !== null && (HISTORY_PERIODS as readonly string[]).includes(value);
}

/** `YYYY-MM-DD` `months` calendar months before `ymd`, the day clamped to the month's length. */
export function monthsBefore(ymd: string, months: number): string {
  const [y = 0, m = 1, d = 1] = ymd.split('-').map(Number);
  const index = y * 12 + (m - 1) - months;
  const year = Math.floor(index / 12);
  const month = index - year * 12; // 0–11
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** First day (Bucharest) a period covers; null for "Tot". */
export function periodStart(period: HistoryPeriod, today: string): string | null {
  switch (period) {
    case 'month':
      return monthsBefore(today, 1);
    case 'quarter':
      return monthsBefore(today, 3);
    case 'year':
      return `${today.slice(0, 4)}-01-01`;
    case 'all':
      return null;
  }
}

export interface HistoryEntry {
  status: HistoryStatus;
  ref: string;
  ended_at: string;
  service_ro: string | null;
  service_en: string | null;
  client_name: string | null;
  car_snapshot: VehicleFields;
  odometer: number | null;
  cost: number | null;
}

/** The day (Bucharest) a job ended: finished, canceled, refused, expired, not shown. */
export function endedDay(entry: { ended_at: string }): string {
  return ymdInBucharest(new Date(entry.ended_at));
}

/**
 * The search (P16b): every word must appear in the plate (typed or without spaces), the car, the
 * client's name, the service (RO or EN), the odometer or the booking code — without diacritics or
 * case, so "BV 12" finds every job on BV 12 ABC and "frâne" every brake job.
 */
export function matchesHistory(entry: HistoryEntry, query: string): boolean {
  const words = searchWords(query);
  if (words.length === 0) return true;
  const car = entry.car_snapshot;
  return matchesWords(
    words,
    car.plate ?? '',
    normalizePlate(car.plate),
    car.make ?? '',
    car.model ?? '',
    car.year ? String(car.year) : '',
    entry.client_name ?? '',
    entry.service_ro ?? '',
    entry.service_en ?? '',
    entry.odometer !== null ? String(entry.odometer) : '',
    entry.ref,
  );
}

export function filterHistory<T extends HistoryEntry>(
  entries: readonly T[],
  options: { query: string; filter: HistoryFilter; period: HistoryPeriod; today: string },
): T[] {
  const from = periodStart(options.period, options.today);
  const statuses = options.filter === 'all' ? null : FILTER_STATUSES[options.filter];
  return entries.filter(
    (e) =>
      (!statuses || statuses.includes(e.status)) &&
      (!from || endedDay(e) >= from) &&
      matchesHistory(e, options.query),
  );
}

/** "{n} reparații · {sum} încasat": the finished jobs and what they brought in (P16b). */
export function historyTotals(entries: readonly HistoryEntry[]): { jobs: number; revenue: number } {
  const done = entries.filter((e) => e.status === 'done');
  return { jobs: done.length, revenue: sumCosts(done) };
}

// ------------------------------------------------------------------ CSV

/**
 * A spreadsheet opens the file the way its language expects: Romanian Excel splits on `;` and reads
 * `340,50`; US English on `,` and `340.50`. So the export follows the interface language.
 */
export function csvFormat(lang: 'ro' | 'en'): { separator: string; decimal: string } {
  return lang === 'ro' ? { separator: ';', decimal: ',' } : { separator: ',', decimal: '.' };
}

/** An amount without grouping, two decimals only when needed: `340`, `340,50`. */
export function csvAmount(amount: number | null, decimal: string): string {
  if (amount === null) return '';
  const cents = Math.round(amount * 100);
  const text = cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  return text.replace('.', decimal);
}

/**
 * One field: quoted when it holds the separator, a quote or a line break; text a spreadsheet would
 * run as a formula (`=`, `+`, `-`, `@` first) gets a leading apostrophe, since names and notes are
 * typed by other people.
 */
export function csvField(value: string, separator: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return v.includes(separator) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Rows to a CSV file body (with a byte-order mark, so Excel reads the diacritics). */
export function toCsv(rows: readonly (readonly string[])[], separator: string): string {
  return '﻿' + rows.map((r) => r.map((f) => csvField(f, separator)).join(separator)).join('\r\n') + '\r\n';
}
