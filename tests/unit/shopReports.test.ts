import { describe, expect, it } from 'vitest';
import { formatCompactAmount, formatMonthShort, formatPercent, formatWeekday } from '../../src/i18n/format';
import { filterHistory, historyTotals, type HistoryEntry } from '../../src/lib/history';
import {
  byService,
  change,
  csvJobs,
  customers,
  duration,
  headline,
  monthlyRevenue,
  periodRange,
  previousRange,
  quoteStats,
  utilization,
  weekdayOf,
  type ReportData,
  type ReportJob,
  type ReportQuote,
} from '../../src/lib/shopReports';

/** A job finished at noon Bucharest (09:00 UTC in summer, 10:00 in winter) on `day`. */
function job(id: string, day: string, cost: number | null, extra: Partial<ReportJob> = {}): ReportJob {
  return {
    id,
    ref: `P-${id}`,
    status: 'done',
    ended_at: `${day}T09:00:00+00:00`,
    cost,
    service_id: 'ulei',
    service_ro: 'Schimb ulei',
    service_en: 'Oil change',
    client: 'c1',
    client_name: 'Ana Marin',
    car_snapshot: { make: 'Dacia', model: 'Logan', year: 2019, plate: 'BV 12 ABC' },
    ...extra,
  };
}

describe('periods (P22)', () => {
  it('"Luna aceasta" runs from the 1st to today, compared with the same days of the month before', () => {
    expect(periodRange('month', '2026-09-25')).toEqual({ from: '2026-09-01', to: '2026-09-25' });
    expect(previousRange('month', '2026-09-25')).toEqual({ from: '2026-08-01', to: '2026-08-25' });
    // The 31st of March is compared with the whole of February.
    expect(previousRange('month', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousRange('month', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-10' });
  });

  it('"Ultimele 3 luni" and "Anul acesta" start where Istoric starts them', () => {
    expect(periodRange('quarter', '2026-09-25')).toEqual({ from: '2026-06-25', to: '2026-09-25' });
    expect(previousRange('quarter', '2026-09-25')).toEqual({ from: '2026-03-25', to: '2026-06-24' });
    expect(periodRange('year', '2026-09-25')).toEqual({ from: '2026-01-01', to: '2026-09-25' });
    expect(previousRange('year', '2026-09-25')).toEqual({ from: '2025-01-01', to: '2025-09-25' });
    expect(previousRange('year', '2028-02-29')).toEqual({ from: '2027-01-01', to: '2027-02-28' });
  });

  it('"Tot" has no start and nothing before it', () => {
    expect(periodRange('all', '2026-09-25')).toEqual({ from: null, to: '2026-09-25' });
    expect(previousRange('all', '2026-09-25')).toBeNull();
  });
});

describe('headline figures', () => {
  const jobs = [
    job('a', '2026-09-20', 340),
    job('b', '2026-09-02', 0.1),
    job('c', '2026-08-20', 0.2),
    job('d', '2026-08-10', 1000),
    job('e', '2026-09-21', 80, { status: 'quote_refused' }),
  ];

  it('sums only finished jobs of the period, in bani', () => {
    expect(headline(jobs, periodRange('month', '2026-09-25'))).toEqual({ revenue: 340.1, jobs: 2, average: 170 });
    expect(headline(jobs, previousRange('month', '2026-09-25')!)).toEqual({ revenue: 1000.2, jobs: 2, average: 500 });
    expect(headline([], periodRange('month', '2026-09-25'))).toEqual({ revenue: 0, jobs: 0, average: null });
  });

  it('matches the totals of Istoric for the same period', () => {
    const entries = jobs.map((j) => ({ ...j, status: j.status, odometer: null }) as HistoryEntry);
    const shown = filterHistory(entries, { query: '', filter: 'all', period: 'quarter', today: '2026-09-25' });
    const totals = historyTotals(shown);
    const report = headline(jobs, periodRange('quarter', '2026-09-25'));
    expect(report.revenue).toBe(totals.revenue);
    expect(report.jobs).toBe(totals.jobs);
  });

  it('counts a job on the day it was finished in Bucharest', () => {
    // 22:30 UTC on Aug 31 is already Sept 1 in Bucharest.
    const late = job('late', '2026-08-31', 100, { ended_at: '2026-08-31T22:30:00+00:00' });
    expect(headline([late], periodRange('month', '2026-09-25')).jobs).toBe(1);
  });

  it('says how much it changed against the period before', () => {
    expect(change(120, 100)).toEqual({ kind: 'up', percent: 20 });
    expect(change(50, 200)).toEqual({ kind: 'down', percent: 75 });
    expect(change(100, 100)).toEqual({ kind: 'same' });
    expect(change(100.2, 100)).toEqual({ kind: 'same' });
    expect(change(0, 0)).toEqual({ kind: 'same' });
    expect(change(100, 0)).toEqual({ kind: 'new' });
    expect(change(null, null)).toEqual({ kind: 'same' });
    expect(change(0, 100)).toEqual({ kind: 'down', percent: 100 });
  });
});

describe('revenue by month', () => {
  it('always shows the last 12 months, this one last, empty months as 0', () => {
    const months = monthlyRevenue(
      [job('a', '2026-09-01', 300), job('b', '2026-09-20', 200), job('c', '2025-10-05', 50), job('d', '2025-09-30', 999)],
      '2026-09-25',
    );
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ month: '2025-10', revenue: 50, jobs: 1 });
    expect(months[11]).toEqual({ month: '2026-09', revenue: 500, jobs: 2 });
    expect(months[5]).toEqual({ month: '2026-03', revenue: 0, jobs: 0 });
  });

  it('ignores refused quotes', () => {
    const months = monthlyRevenue([job('a', '2026-09-01', 80, { status: 'quote_refused' })], '2026-09-25');
    expect(months[11]!.revenue).toBe(0);
  });
});

describe('jobs by service', () => {
  const range = periodRange('all', '2026-09-25');

  it('puts the most frequent first, with count and revenue', () => {
    const rows = byService(
      [
        job('a', '2026-09-01', 1500, { service_id: 'ambr', service_ro: 'Ambreiaj' }),
        job('b', '2026-09-02', 300),
        job('c', '2026-09-03', 310),
      ],
      range,
    );
    expect(rows.map((r) => [r.service_id, r.count, r.revenue])).toEqual([
      ['ulei', 2, 610],
      ['ambr', 1, 1500],
    ]);
  });

  it('keeps the top 8 and groups the rest as "Altele"', () => {
    const jobs = Array.from({ length: 10 }, (_, i) =>
      Array.from({ length: 10 - i }, (_, k) => job(`${i}-${k}`, '2026-09-01', 100, { service_id: `s${i}` })),
    ).flat();
    const rows = byService(jobs, range);
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({ service_id: 's0', count: 10 });
    expect(rows[8]).toEqual({ service_id: null, name_ro: null, name_en: null, count: 3, revenue: 300 });
  });

  it('shows a ninth service by name rather than an "Altele" of one', () => {
    const jobs = Array.from({ length: 9 }, (_, i) => job(String(i), '2026-09-01', 100, { service_id: `s${i}` }));
    expect(byService(jobs, range).every((r) => r.service_id !== null)).toBe(true);
  });
});

describe('customers', () => {
  it('counts unique customers of the period and those with more than one job ever', () => {
    const jobs = [
      job('a', '2026-09-10', 100, { client: 'ana' }),
      job('b', '2026-09-12', 100, { client: 'ana' }),
      job('c', '2026-09-15', 100, { client: 'bogdan' }), // came back: a job last year
      job('d', '2025-05-01', 100, { client: 'bogdan' }),
      job('e', '2026-09-16', 100, { client: 'cristi' }), // first time
      job('f', '2026-09-17', 80, { client: 'dan', status: 'quote_refused' }), // not a job
      job('g', '2026-09-18', 100, { client: null }), // deleted accounts: one customer each
      job('h', '2026-09-19', 100, { client: null }),
    ];
    const c = customers(jobs, periodRange('month', '2026-09-25'));
    expect(c.unique).toBe(5);
    expect(c.returning).toBe(2);
    expect(c.returningShare).toBeCloseTo(0.4);
    expect(c.jobsPerCustomer).toBeCloseTo(6 / 5);
    expect(customers([], periodRange('month', '2026-09-25'))).toEqual({
      unique: 0,
      returning: 0,
      returningShare: null,
      jobsPerCustomer: null,
    });
  });
});

describe('quotes', () => {
  const q = (status: ReportQuote['status'], decided: string, hours: number): ReportQuote => ({
    status,
    decided_at: decided,
    sent_at: new Date(Date.parse(decided) - hours * 3_600_000).toISOString(),
  });

  it('acceptance = accepted (in full or in part) ÷ decided, on the day of the decision', () => {
    const quotes = [
      q('accepted', '2026-09-10T10:00:00Z', 2),
      q('partially_accepted', '2026-09-11T10:00:00Z', 4),
      q('refused', '2026-09-12T10:00:00Z', 6),
      q('expired', '2026-09-13T10:00:00Z', 72),
      q('accepted', '2026-08-13T10:00:00Z', 1), // another month
    ];
    const jobs = [
      job('r', '2026-09-12', 80, { status: 'quote_refused' }),
      job('r0', '2026-09-12', 0, { status: 'quote_refused' }),
      job('old', '2026-08-12', 50, { status: 'quote_refused' }),
    ];
    const s = quoteStats(quotes, jobs, periodRange('month', '2026-09-25'));
    expect(s).toEqual({ decided: 4, accepted: 2, refused: 2, rate: 0.5, fees: 80, averageResponseMs: 4 * 3_600_000 });
  });

  it('has no rate and no answer time without quotes', () => {
    expect(quoteStats([], [], periodRange('month', '2026-09-25'))).toMatchObject({ rate: null, averageResponseMs: null, fees: 0 });
    // Only expired quotes: nobody answered.
    const s = quoteStats([q('expired', '2026-09-13T10:00:00Z', 72)], [], periodRange('month', '2026-09-25'));
    expect(s).toMatchObject({ decided: 1, accepted: 0, refused: 1, rate: 0, averageResponseMs: null });
  });

  it('writes answer times in minutes, hours or days', () => {
    expect(duration(20_000)).toEqual({ unit: 'minutes', value: 1 });
    expect(duration(35 * 60_000)).toEqual({ unit: 'minutes', value: 35 });
    expect(duration(3.4 * 3_600_000)).toEqual({ unit: 'hours', value: 3 });
    expect(duration(47 * 3_600_000)).toEqual({ unit: 'hours', value: 47 });
    expect(duration(60 * 3_600_000)).toEqual({ unit: 'days', value: 3 });
  });
});

describe('utilization', () => {
  const data = (extra: Partial<ReportData> = {}): ReportData => ({
    shop: { id: 's', name: 'Atelier', daily_capacity: 4, since: '2026-01-01' },
    open_weekdays: [1, 2, 3, 4, 5],
    closures: [],
    jobs: [],
    quotes: [],
    days: [],
    ...extra,
  });

  it('averages cars over the days the shop was open, against its capacity', () => {
    // Sept 1–25, 2026: Sept 1 is a Tuesday → 19 weekdays.
    expect(weekdayOf('2026-09-01')).toBe(2);
    const u = utilization(
      data({
        closures: [{ start: '2026-09-07', end: '2026-09-08' }], // Mon + Tue closed → 17 open days
        days: [
          { date: '2026-09-02', cars: 4 }, // Wednesday
          { date: '2026-09-09', cars: 3 }, // Wednesday
          { date: '2026-09-04', cars: 5 }, // Friday
          { date: '2026-08-31', cars: 9 }, // before the period
        ],
      }),
      periodRange('month', '2026-09-25'),
    );
    expect(u.openDays).toBe(17);
    expect(u.cars).toBe(12);
    expect(u.perDay).toBeCloseTo(12 / 17);
    expect(u.share).toBeCloseTo(12 / 17 / 4);
    expect(u.busiestWeekday).toBe(3);
  });

  it('starts on the day the shop joined, and has nothing to say without open days', () => {
    const u = utilization(data({ shop: { id: 's', name: 'A', daily_capacity: 2, since: '2026-09-21' } }), periodRange('all', '2026-09-25'));
    expect(u.openDays).toBe(5);
    expect(u.busiestWeekday).toBeNull();
    const closed = utilization(data({ open_weekdays: [] }), periodRange('month', '2026-09-25'));
    expect(closed).toMatchObject({ openDays: 0, perDay: null, share: null });
  });
});

describe('CSV of the period', () => {
  it('lists finished jobs and fees actually charged, newest first', () => {
    const rows = csvJobs(
      [
        job('a', '2026-09-10', 340),
        job('b', '2026-09-12', 80, { status: 'quote_refused' }),
        job('c', '2026-09-13', 0, { status: 'quote_refused' }),
        job('d', '2026-08-01', 500),
      ],
      periodRange('month', '2026-09-25'),
    );
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('report formatters', () => {
  it('writes amounts short enough for a chart bar', () => {
    expect(formatCompactAmount('ro', 850)).toBe('850');
    expect(formatCompactAmount('ro', 1250)).toBe('1,3k');
    expect(formatCompactAmount('en', 1250)).toBe('1.3k');
    expect(formatCompactAmount('ro', 12_450)).toBe('12k');
    expect(formatCompactAmount('en', 2000)).toBe('2k');
  });

  it('names months, weekdays and percentages in the interface language', () => {
    expect(formatMonthShort('ro', '2026-01')).toBe('ian');
    expect(formatMonthShort('en', '2026-09')).toBe('Sep');
    expect(formatWeekday('ro', 2)).toBe('Marți');
    expect(formatWeekday('en', 0)).toBe('Sunday');
    expect(formatPercent('en', 0.456)).toBe('46%');
  });
});
