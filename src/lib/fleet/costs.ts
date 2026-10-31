import { ymdInBucharest } from '../../i18n/format';
import type { FleetCategory, FleetExpense, FleetJob, FleetVehicle } from './types';

/**
 * The fleet's costs (docs/FLEET_PLAN.md §5). One ledger, two sources that never overlap:
 *
 *  - `service`: a Service-Hub job that ended. A `done` job counts once, for its final `cost`, on
 *    the day it was finished (Bucharest). A refused quote counts its inspection fee. A quote that is
 *    only sent or approved is never a cost — the final cost is what the shop wrote at completion.
 *  - `manual`: an expense the company typed in. One that points at a Service-Hub job already counted
 *    is left out of the totals and listed apart, so the same repair is never summed twice.
 *
 * Totals are in lei. An expense in another currency is listed, never converted or added.
 */

export const BASE_CURRENCY = 'RON';

export type CostSource = 'service' | 'manual';

export interface CostEntry {
  id: string;
  source: CostSource;
  vehicle_id: string;
  day: string;
  amount: number;
  category: FleetCategory;
  /** The shop for a Service-Hub job, else null. */
  shop_id: string | null;
  /** Shop name, or the supplier typed in. */
  vendor: string | null;
  booking_id: string | null;
  odometer: number | null;
  /** True for the inspection fee of a refused quote. */
  fee: boolean;
}

/** Which fleet category a Service-Hub job falls in, from its first service's catalog category. */
export function categoryOfService(catalogCategory: string): FleetCategory {
  switch (catalogCategory) {
    case 'cat_rev':
      return 'maintenance';
    case 'cat_anv':
      return 'tires';
    case 'cat_itp':
      return 'itp';
    case 'cat_det':
      return 'consumables';
    default:
      return 'repairs';
  }
}

export function jobEndDay(job: Pick<FleetJob, 'date' | 'done_at'>): string {
  return job.done_at ? ymdInBucharest(new Date(job.done_at)) : job.date;
}

function fromJob(job: FleetJob): CostEntry | null {
  if (job.cost === null || job.cost <= 0) return null;
  if (job.status !== 'done' && job.status !== 'quote_refused') return null;
  return {
    id: `job:${job.id}`,
    source: 'service',
    vehicle_id: job.vehicle_id,
    day: jobEndDay(job),
    amount: job.cost,
    category: job.status === 'done' ? categoryOfService(job.service_category) : 'repairs',
    shop_id: job.shop_id,
    vendor: job.shop_name,
    booking_id: job.id,
    odometer: job.status === 'done' ? job.odometer : null,
    fee: job.status === 'quote_refused',
  };
}

export interface Ledger {
  /** Counted in every total. */
  entries: CostEntry[];
  /** Manual expenses for a job already counted: shown, never summed. */
  duplicates: FleetExpense[];
  /** Expenses in another currency: shown, never summed. */
  foreign: FleetExpense[];
}

export function buildLedger(jobs: readonly FleetJob[], expenses: readonly FleetExpense[]): Ledger {
  const entries: CostEntry[] = [];
  const counted = new Set<string>();
  for (const job of jobs) {
    const entry = fromJob(job);
    if (!entry) continue;
    entries.push(entry);
    counted.add(job.id);
  }
  const duplicates: FleetExpense[] = [];
  const foreign: FleetExpense[] = [];
  for (const e of expenses) {
    if (e.deleted_at) continue;
    if (e.booking_id && counted.has(e.booking_id)) {
      duplicates.push(e);
      continue;
    }
    if (e.currency.toUpperCase() !== BASE_CURRENCY) {
      foreign.push(e);
      continue;
    }
    if (!(e.amount > 0)) continue;
    entries.push({
      id: `exp:${e.id}`,
      source: 'manual',
      vehicle_id: e.vehicle_id,
      day: e.day,
      amount: e.amount,
      category: e.category,
      shop_id: null,
      vendor: e.supplier,
      booking_id: e.booking_id,
      odometer: e.odometer,
      fee: false,
    });
  }
  entries.sort((a, b) => b.day.localeCompare(a.day) || a.id.localeCompare(b.id));
  return { entries, duplicates, foreign };
}

// ------------------------------------------------------------------ filters and sums

export interface DayRange {
  /** Inclusive, `YYYY-MM-DD`; null = from the beginning. */
  from: string | null;
  /** Inclusive. */
  to: string;
}

export interface CostFilter {
  range?: DayRange;
  vehicleIds?: readonly string[];
  categories?: readonly FleetCategory[];
  shopIds?: readonly string[];
  source?: CostSource;
}

export function inRange(day: string, range: DayRange): boolean {
  return (range.from === null || day >= range.from) && day <= range.to;
}

export function filterCosts(entries: readonly CostEntry[], f: CostFilter): CostEntry[] {
  return entries.filter(
    (e) =>
      (!f.range || inRange(e.day, f.range)) &&
      (!f.vehicleIds?.length || f.vehicleIds.includes(e.vehicle_id)) &&
      (!f.categories?.length || f.categories.includes(e.category)) &&
      (!f.shopIds?.length || (e.shop_id !== null && f.shopIds.includes(e.shop_id))) &&
      (!f.source || e.source === f.source),
  );
}

/** Sums in whole bani, so 0.1 + 0.2 is 0.30 and never 0.30000000000000004. */
export function sumAmounts(entries: readonly { amount: number }[]): number {
  return entries.reduce((cents, e) => cents + Math.round(e.amount * 100), 0) / 100;
}

export interface Group {
  key: string;
  total: number;
  count: number;
}

/** Totals per key, largest first (ties by key, so the order never flickers). */
export function totalsBy(entries: readonly CostEntry[], key: (e: CostEntry) => string | null): Group[] {
  const map = new Map<string, CostEntry[]>();
  for (const e of entries) {
    const k = key(e);
    if (k === null) continue;
    const list = map.get(k);
    if (list) list.push(e);
    else map.set(k, [e]);
  }
  return [...map.entries()]
    .map(([k, list]) => ({ key: k, total: sumAmounts(list), count: list.length }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

/** `YYYY-MM` of the `count` months ending with the month of `today`, oldest first. */
export function lastMonths(today: string, count: number): string[] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const index = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

export interface MonthTotal {
  month: string;
  total: number;
}

export function monthlyTotals(entries: readonly CostEntry[], months: readonly string[]): MonthTotal[] {
  return months.map((month) => ({ month, total: sumAmounts(entries.filter((e) => e.day.startsWith(month))) }));
}

export function monthRange(today: string): DayRange {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function yearRange(today: string): DayRange {
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

/**
 * The cars that belonged to the fleet during the range: added on or before its last day and not
 * archived before its first. The average cost per car divides by these, not by today's fleet.
 */
export function vehiclesInRange(vehicles: readonly FleetVehicle[], range: DayRange): FleetVehicle[] {
  return vehicles.filter((v) => {
    const added = ymdInBucharest(new Date(v.created_at));
    const archived = v.archived_at ? ymdInBucharest(new Date(v.archived_at)) : null;
    return added <= range.to && (archived === null || range.from === null || archived >= range.from);
  });
}

/** Total ÷ cars in the fleet during the range; null without cars. */
export function averagePerVehicle(entries: readonly CostEntry[], vehicles: readonly FleetVehicle[], range: DayRange): number | null {
  const count = vehiclesInRange(vehicles, range).length;
  if (count === 0) return null;
  return Math.round((sumAmounts(filterCosts(entries, { range })) / count) * 100) / 100;
}

// ------------------------------------------------------------------ budget

export interface BudgetUsage {
  budget: number;
  spent: number;
  /** Never below 0. */
  remaining: number;
  /** spent ÷ budget (above 1 when over). */
  used: number;
  /** How far over, as a share of the budget; 0 when within it. */
  over: number;
}

/** Null when the company set no budget: a default would only mislead. */
export function budgetUsage(budget: number | null, spent: number): BudgetUsage | null {
  if (budget === null || !(budget > 0)) return null;
  const used = spent / budget;
  return {
    budget,
    spent,
    remaining: Math.max(0, Math.round((budget - spent) * 100) / 100),
    used,
    over: used > 1 ? used - 1 : 0,
  };
}

// ------------------------------------------------------------------ parts and labor

/**
 * What a finished job's approved lines say about parts and labor. This splits a job's cost; it is
 * never added on top of it. Null when the lines carry no kind (older quotes) or the job has no
 * accepted quote — then the split is simply unknown.
 */
export function partsAndLabor(job: FleetJob): { parts: number; labor: number; other: number } | null {
  const q = job.quote;
  if (job.status !== 'done' || !q || (q.status !== 'accepted' && q.status !== 'partially_accepted')) return null;
  const lines = q.items.filter((i) => i.approved);
  if (lines.length === 0 || lines.every((i) => i.kind === null)) return null;
  const sum = (kind: 'part' | 'labor' | null) => sumAmounts(lines.filter((i) => i.kind === kind).map((i) => ({ amount: i.price })));
  return { parts: sum('part'), labor: sum('labor'), other: sum(null) };
}
