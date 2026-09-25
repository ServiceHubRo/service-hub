import { ymdInBucharest } from '../i18n/format';
import type { CarSnapshot } from '../data/bookings';
import { monthsBefore, periodStart, sumCosts } from './history';

/**
 * Rapoarte (FR §4.9, P22): pure logic for the shop owner's reports. The database answers the raw
 * rows once (`shop_reports()`); everything here is a sum over them, so switching the period never
 * reads again. The rules match Istoric: a finished job counts on the day it was finished (Bucharest)
 * for its `cost`, and "Ultimele 3 luni" / "Anul acesta" start on the same day as there.
 */

// ------------------------------------------------------------------ data

export interface ReportJob {
  id: string;
  ref: string;
  status: 'done' | 'quote_refused';
  ended_at: string;
  cost: number | null;
  service_id: string;
  service_ro: string | null;
  service_en: string | null;
  /** The client's account; null once the account was deleted. */
  client: string | null;
  client_name: string | null;
  car_snapshot: CarSnapshot;
}

export interface ReportQuote {
  status: 'accepted' | 'partially_accepted' | 'refused' | 'expired';
  sent_at: string;
  decided_at: string;
}

export interface ReportData {
  shop: { id: string; name: string; daily_capacity: number; since: string };
  open_weekdays: number[];
  closures: { start: string; end: string }[];
  jobs: ReportJob[];
  quotes: ReportQuote[];
  days: { date: string; cars: number }[];
}

/** Below this many finished jobs (ever) the screen shows a message instead of charts (P22). */
export const MIN_JOBS = 3;
/** Below this acceptance rate a muted line explains what it usually means (FR §4.9). */
export const LOW_ACCEPTANCE = 0.7;
/** Services shown by name in "Lucrări pe tip de serviciu"; the rest are "Altele". */
export const TOP_SERVICES = 8;

// ------------------------------------------------------------------ periods

export type ReportPeriod = 'month' | 'quarter' | 'year' | 'all';
export const REPORT_PERIODS: readonly ReportPeriod[] = ['month', 'quarter', 'year', 'all'];

export function isReportPeriod(value: string | null): value is ReportPeriod {
  return value !== null && (REPORT_PERIODS as readonly string[]).includes(value);
}

/** Calendar days, both ends included; `from` null = since the beginning. */
export interface DayRange {
  from: string | null;
  to: string;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, as in `shop_hours`. */
export function weekdayOf(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

/**
 * The days a period covers, up to today: "Luna aceasta" from the 1st, "Ultimele 3 luni" and
 * "Anul acesta" exactly as in Istoric, "Tot" from the beginning.
 */
export function periodRange(period: ReportPeriod, today: string): DayRange {
  if (period === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  return { from: periodStart(period, today), to: today };
}

/**
 * The comparable period before (P22): the same stretch of the month, of the three months or of the
 * year before — so the 25th of this month is compared with the 1st–25th of the last one, never with
 * a whole month. "Tot" has nothing before it.
 */
export function previousRange(period: ReportPeriod, today: string): DayRange | null {
  switch (period) {
    case 'month':
      return { from: monthsBefore(`${today.slice(0, 7)}-01`, 1), to: monthsBefore(today, 1) };
    case 'quarter':
      return { from: monthsBefore(today, 6), to: addDays(monthsBefore(today, 3), -1) };
    case 'year':
      return { from: `${Number(today.slice(0, 4)) - 1}-01-01`, to: monthsBefore(today, 12) };
    case 'all':
      return null;
  }
}

export function inRange(ymd: string, range: DayRange): boolean {
  return (range.from === null || ymd >= range.from) && ymd <= range.to;
}

/** The day (Bucharest) a job was finished or a quote refused. */
export function jobDay(job: { ended_at: string }): string {
  return ymdInBucharest(new Date(job.ended_at));
}

function doneIn(jobs: readonly ReportJob[], range: DayRange): ReportJob[] {
  return jobs.filter((j) => j.status === 'done' && inRange(jobDay(j), range));
}

export function doneCount(jobs: readonly ReportJob[]): number {
  return jobs.filter((j) => j.status === 'done').length;
}

// ------------------------------------------------------------------ headline

export interface Headline {
  revenue: number;
  jobs: number;
  /** Încasat ÷ lucrări, in whole lei; null without jobs. */
  average: number | null;
}

/** Încasat, Lucrări, Valoare medie — finished jobs only, like the totals of Istoric. */
export function headline(jobs: readonly ReportJob[], range: DayRange): Headline {
  const done = doneIn(jobs, range);
  const revenue = sumCosts(done);
  return { revenue, jobs: done.length, average: done.length ? Math.round(revenue / done.length) : null };
}

export type Change =
  | { kind: 'up' | 'down'; percent: number }
  | { kind: 'same' }
  /** Nothing to compare with: the period before had nothing. */
  | { kind: 'new' };

/** The change against the period before, in whole percent. */
export function change(current: number | null, previous: number | null): Change {
  const now = current ?? 0;
  const before = previous ?? 0;
  if (before === 0) return now === 0 ? { kind: 'same' } : { kind: 'new' };
  const percent = Math.round(((now - before) / before) * 100);
  if (percent === 0) return { kind: 'same' };
  return percent > 0 ? { kind: 'up', percent } : { kind: 'down', percent: -percent };
}

// ------------------------------------------------------------------ revenue by month

export interface MonthRevenue {
  /** `YYYY-MM` */
  month: string;
  revenue: number;
  jobs: number;
}

/** The last 12 calendar months, this one last (P22: independent of the period chips). */
export function monthlyRevenue(jobs: readonly ReportJob[], today: string): MonthRevenue[] {
  const first = `${today.slice(0, 7)}-01`;
  const months = Array.from({ length: 12 }, (_, i) => monthsBefore(first, 11 - i).slice(0, 7));
  const byMonth = new Map(months.map((m) => [m, { month: m, cents: 0, jobs: 0 }]));
  for (const j of jobs) {
    if (j.status !== 'done') continue;
    const bucket = byMonth.get(jobDay(j).slice(0, 7));
    if (!bucket) continue;
    bucket.cents += Math.round((j.cost ?? 0) * 100);
    bucket.jobs += 1;
  }
  return months.map((m) => {
    const b = byMonth.get(m)!;
    return { month: m, revenue: b.cents / 100, jobs: b.jobs };
  });
}

// ------------------------------------------------------------------ jobs by service

export interface ServiceRow {
  /** null for "Altele". */
  service_id: string | null;
  name_ro: string | null;
  name_en: string | null;
  count: number;
  revenue: number;
}

/** Most frequent first (then the bigger revenue), the top 8 by name and the rest as "Altele". */
export function byService(jobs: readonly ReportJob[], range: DayRange): ServiceRow[] {
  const groups = new Map<string, ServiceRow & { cents: number }>();
  for (const j of doneIn(jobs, range)) {
    let g = groups.get(j.service_id);
    if (!g) {
      g = { service_id: j.service_id, name_ro: j.service_ro, name_en: j.service_en, count: 0, revenue: 0, cents: 0 };
      groups.set(j.service_id, g);
    }
    g.count += 1;
    g.cents += Math.round((j.cost ?? 0) * 100);
  }
  const rows = [...groups.values()]
    .map(({ cents, ...g }) => ({ ...g, revenue: cents / 100 }))
    .sort((a, b) => b.count - a.count || b.revenue - a.revenue || a.service_id!.localeCompare(b.service_id!));
  if (rows.length <= TOP_SERVICES + 1) return rows;
  const rest = rows.slice(TOP_SERVICES);
  const other: ServiceRow = {
    service_id: null,
    name_ro: null,
    name_en: null,
    count: rest.reduce((n, r) => n + r.count, 0),
    revenue: rest.reduce((c, r) => c + Math.round(r.revenue * 100), 0) / 100,
  };
  return [...rows.slice(0, TOP_SERVICES), other];
}

// ------------------------------------------------------------------ customers

export interface Customers {
  unique: number;
  /** Of the unique ones, those with more than one finished job here, ever. */
  returning: number;
  /** 0–1; null without customers. */
  returningShare: number | null;
  /** Jobs ÷ unique customers; null without customers. */
  jobsPerCustomer: number | null;
}

/** A deleted account counts as one customer per job: there is no way to tell them apart. */
function customerKey(job: ReportJob): string {
  return job.client ?? `job:${job.id}`;
}

export function customers(jobs: readonly ReportJob[], range: DayRange): Customers {
  const ever = new Map<string, number>();
  for (const j of jobs) {
    if (j.status === 'done') ever.set(customerKey(j), (ever.get(customerKey(j)) ?? 0) + 1);
  }
  const done = doneIn(jobs, range);
  const inPeriod = new Set(done.map(customerKey));
  const returning = [...inPeriod].filter((k) => (ever.get(k) ?? 0) > 1).length;
  const unique = inPeriod.size;
  return {
    unique,
    returning,
    returningShare: unique ? returning / unique : null,
    jobsPerCustomer: unique ? done.length / unique : null,
  };
}

// ------------------------------------------------------------------ quotes

export interface QuoteStats {
  /** Quotes the client decided or let expire in the period. */
  decided: number;
  /** Accepted in full or in part. */
  accepted: number;
  /** Refused, or left to expire. */
  refused: number;
  /** accepted ÷ decided, 0–1; null without quotes. */
  rate: number | null;
  /** Inspection fees charged on refused quotes. */
  fees: number;
  /** How long clients took to answer (refused or accepted; an expired one had no answer). */
  averageResponseMs: number | null;
}

/** Counted on the day the client decided (or the quote expired), like the fees. */
export function quoteStats(quotes: readonly ReportQuote[], jobs: readonly ReportJob[], range: DayRange): QuoteStats {
  const decided = quotes.filter((q) => inRange(ymdInBucharest(new Date(q.decided_at)), range));
  const accepted = decided.filter((q) => q.status === 'accepted' || q.status === 'partially_accepted').length;
  const answered = decided.filter((q) => q.status !== 'expired');
  const totalMs = answered.reduce((ms, q) => ms + Math.max(0, Date.parse(q.decided_at) - Date.parse(q.sent_at)), 0);
  const fees = sumCosts(jobs.filter((j) => j.status === 'quote_refused' && inRange(jobDay(j), range)));
  return {
    decided: decided.length,
    accepted,
    refused: decided.length - accepted,
    rate: decided.length ? accepted / decided.length : null,
    fees,
    averageResponseMs: answered.length ? totalMs / answered.length : null,
  };
}

export type Duration = { unit: 'minutes' | 'hours' | 'days'; value: number };

/** Minutes under an hour, hours under two days, else days — whole numbers, never 0. */
export function duration(ms: number): Duration {
  const minutes = ms / 60_000;
  if (minutes < 60) return { unit: 'minutes', value: Math.max(1, Math.round(minutes)) };
  const hours = minutes / 60;
  if (hours < 48) return { unit: 'hours', value: Math.round(hours) };
  return { unit: 'days', value: Math.round(hours / 24) };
}

// ------------------------------------------------------------------ utilization

export interface Utilization {
  /** Days the shop was open in the period (its week and closures as set now), up to today. */
  openDays: number;
  cars: number;
  /** Cars ÷ open days; null without open days. */
  perDay: number | null;
  capacity: number;
  /** perDay ÷ capacity, 0–1 (more when the shop took extra cars); null without open days. */
  share: number | null;
  /** The weekday with the most cars (0 = Sunday); null without cars. */
  busiestWeekday: number | null;
}

/**
 * Average cars a day against the daily capacity (P22): every car that took a place — confirmed or
 * further, done, refused or expired quotes; not requests, declines, cancellations or no-shows —
 * over the days the shop was open, from the day it joined.
 */
export function utilization(data: ReportData, range: DayRange): Utilization {
  const from = range.from === null || range.from < data.shop.since ? data.shop.since : range.from;
  const open = new Set(data.open_weekdays);
  const closed = (ymd: string) => data.closures.some((c) => ymd >= c.start && ymd <= c.end);
  let openDays = 0;
  for (let d = from; d <= range.to; d = addDays(d, 1)) {
    if (open.has(weekdayOf(d)) && !closed(d)) openDays += 1;
  }
  const perWeekday = new Array<number>(7).fill(0);
  let cars = 0;
  for (const day of data.days) {
    if (day.date < from || day.date > range.to) continue;
    cars += day.cars;
    perWeekday[weekdayOf(day.date)]! += day.cars;
  }
  const most = Math.max(...perWeekday);
  const perDay = openDays ? cars / openDays : null;
  return {
    openDays,
    cars,
    perDay,
    capacity: data.shop.daily_capacity,
    share: perDay === null ? null : perDay / data.shop.daily_capacity,
    busiestWeekday: most > 0 ? perWeekday.indexOf(most) : null,
  };
}

// ------------------------------------------------------------------ CSV

/** What the period brought in, for the accountant: finished jobs and inspection fees, newest first. */
export function csvJobs(jobs: readonly ReportJob[], range: DayRange): ReportJob[] {
  return jobs
    .filter((j) => inRange(jobDay(j), range) && (j.status === 'done' || (j.cost ?? 0) > 0))
    .sort((a, b) => b.ended_at.localeCompare(a.ended_at));
}
