import { jobEndDay, lastMonths, type CostEntry } from './costs';
import { readingsOf, costPerKm } from './costPerKm';
import type { FleetOverview } from './types';
import { ymdInBucharest } from '../../i18n/format';

/**
 * A fleet report as `fleet_report()` answers it (T65): computed in the database, per plan and
 * role, so a plan without reports gets none and Fleet Pro's advanced part comes only to Pro.
 * `buildReport` makes the same answer from a company read, for the design preview and the unit
 * test that keeps both on the same numbers (tests/sql/139_fleet_plan_features.sql has the case).
 */
export interface ReportGroup {
  key: string;
  total: number;
  count: number;
}

export type PerKmResult =
  | { vehicle_id: string; status: 'ok'; km: number; cost: number; per_km: number }
  | { vehicle_id: string; status: 'no_readings' | 'one_reading' | 'inconsistent' | 'no_distance' };

export interface ReportFilters {
  vehicle_ids?: string[];
  departments?: string[];
  vehicle_types?: string[];
  categories?: string[];
  shop_ids?: string[];
}

export interface FleetReport {
  range: { from: string | null; to: string };
  total: number;
  count: number;
  vehicles_in_range: number;
  avg_per_vehicle: number | null;
  previous: { from: string | null; to: string; total: number } | null;
  by_category: ReportGroup[];
  by_vehicle: (ReportGroup & { top_category: string })[];
  by_shop: (ReportGroup & { name: string })[];
  repairs: { vehicle_id: string; count: number; last_day: string; total: number }[];
  monthly: { month: string; total: number }[];
  features: string[];
  /** With `budget`: this month and this year, the whole fleet. */
  budget?: { monthly: { budget: number; spent: number } | null; yearly: { budget: number; spent: number } | null };
  /** With `budget_forecast` (Pro): where the month and the year end at the pace so far. */
  forecast?: { month_spent: number; month_end: number; year_spent: number; year_end: number };
  /** With `cost_per_km`. */
  per_km?: { total: { km: number; cost: number; per_km: number } | null; per_vehicle: PerKmResult[] };
  /** With `reports_advanced` (Pro). */
  advanced?: {
    high_cost: string[];
    previous_by_vehicle: { key: string; total: number }[];
    vehicle_monthly: { vehicle_id: string; months: { month: string; total: number }[] }[];
  };
}

const cents = (n: number) => Math.round(n * 100) / 100;
const sum = (list: readonly { amount: number }[]) => list.reduce((c, e) => c + Math.round(e.amount * 100), 0) / 100;

function groupBy<T>(list: readonly T[], key: (x: T) => string) {
  const map = new Map<string, T[]>();
  for (const x of list) map.set(key(x), [...(map.get(key(x)) ?? []), x]);
  return map;
}

/** The ledger rows of a report: done jobs and refused quotes only (expenses join with T63e). */
function ledger(data: FleetOverview): (CostEntry & { done: boolean })[] {
  const out: (CostEntry & { done: boolean })[] = [];
  for (const j of data.jobs) {
    if (j.cost === null || j.cost <= 0 || (j.status !== 'done' && j.status !== 'quote_refused')) continue;
    const cat = j.status !== 'done' ? 'repairs' : ({ cat_rev: 'maintenance', cat_anv: 'tires', cat_itp: 'itp', cat_det: 'consumables' } as Record<string, string>)[j.service_category] ?? 'repairs';
    out.push({
      id: j.id,
      source: 'service',
      vehicle_id: j.vehicle_id,
      day: jobEndDay(j),
      amount: j.cost,
      category: cat as CostEntry['category'],
      shop_id: j.shop_id,
      vendor: j.shop_name,
      booking_id: j.id,
      odometer: j.status === 'done' ? j.odometer : null,
      fee: j.status !== 'done',
      done: j.status === 'done',
    });
  }
  return out;
}

/** The same answer as `fleet_report()`, from a company read (preview and tests). */
export function buildReport(
  data: FleetOverview,
  features: readonly string[],
  range: { from: string | null; to: string },
  previous: { from: string | null; to: string } | null,
  filters: ReportFilters = {},
  today: string = ymdInBucharest(new Date()),
): FleetReport {
  const vehicles = data.vehicles.filter(
    (v) =>
      (!filters.vehicle_ids || filters.vehicle_ids.includes(v.id)) &&
      (!filters.departments || (v.department !== null && filters.departments.includes(v.department))) &&
      (!filters.vehicle_types || (v.vehicle_type !== null && filters.vehicle_types.includes(v.vehicle_type))),
  );
  const ids = new Set(vehicles.map((v) => v.id));
  const all = ledger(data);
  const scoped = all.filter(
    (e) => ids.has(e.vehicle_id) && (!filters.categories || filters.categories.includes(e.category)) && (!filters.shop_ids || (e.shop_id !== null && filters.shop_ids.includes(e.shop_id))),
  );
  const inside = (r: { from: string | null; to: string }) => (e: { day: string }) => (r.from === null || e.day >= r.from) && e.day <= r.to;
  const now = scoped.filter(inside(range));
  const total = sum(now);
  const cars = vehicles.filter((v) => {
    const added = ymdInBucharest(new Date(v.created_at));
    const archived = v.archived_at ? ymdInBucharest(new Date(v.archived_at)) : null;
    return added <= range.to && (archived === null || range.from === null || archived >= range.from);
  }).length;
  const groups = <T,>(list: readonly (CostEntry & { done: boolean })[], key: (e: CostEntry) => string, extra: (k: string, l: (CostEntry & { done: boolean })[]) => T) =>
    [...groupBy(list, key)].map(([k, l]) => ({ key: k, total: sum(l), count: l.length, ...extra(k, l) })).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  const topCategory = (l: readonly CostEntry[]) => groups(l as (CostEntry & { done: boolean })[], (e) => e.category, () => ({}))[0]!.key;
  const months = lastMonths(today, 12);
  const has = (f: string) => features.includes(f);

  const report: FleetReport = {
    range,
    total,
    count: now.length,
    vehicles_in_range: cars,
    avg_per_vehicle: cars > 0 ? cents(total / cars) : null,
    previous: previous ? { ...previous, total: sum(scoped.filter(inside(previous))) } : null,
    by_category: groups(now, (e) => e.category, () => ({})),
    by_vehicle: groups(now, (e) => e.vehicle_id, (_k, l) => ({ top_category: topCategory(l) })),
    by_shop: groups(now, (e) => e.shop_id ?? '', (_k, l) => ({ name: l[0]!.vendor ?? '' })),
    repairs: [...groupBy(now.filter((e) => e.done), (e) => e.vehicle_id)]
      .map(([k, l]) => ({ vehicle_id: k, count: l.length, last_day: l.map((e) => e.day).sort().at(-1)!, total: sum(l) }))
      .sort((a, b) => b.count - a.count || a.vehicle_id.localeCompare(b.vehicle_id)),
    monthly: months.map((m) => ({ month: m, total: sum(scoped.filter((e) => e.day.startsWith(m))) })),
    features: [...features],
  };

  if (has('budget')) {
    const monthSpent = sum(all.filter((e) => e.day >= `${today.slice(0, 7)}-01` && e.day <= today));
    const yearSpent = sum(all.filter((e) => e.day >= `${today.slice(0, 4)}-01-01` && e.day <= today));
    report.budget = {
      monthly: data.company.budget.monthly === null ? null : { budget: data.company.budget.monthly, spent: monthSpent },
      yearly: data.company.budget.yearly === null ? null : { budget: data.company.budget.yearly, spent: yearSpent },
    };
    if (has('budget_forecast')) {
      const d = new Date(`${today}T12:00:00Z`);
      const day = d.getUTCDate();
      const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      const doy = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000);
      const daysInYear = new Date(Date.UTC(d.getUTCFullYear(), 1, 29)).getUTCMonth() === 1 ? 366 : 365;
      report.forecast = { month_spent: monthSpent, month_end: cents((monthSpent / day) * daysInMonth), year_spent: yearSpent, year_end: cents((yearSpent / doy) * daysInYear) };
    }
  }

  if (has('cost_per_km')) {
    const perVehicle: PerKmResult[] = vehicles
      .filter((v) => !v.archived_at)
      .map((v) => {
        const r = costPerKm(readingsOf(v.id, data.jobs, []), all.filter((e) => e.vehicle_id === v.id), range);
        return r.status === 'ok' ? { vehicle_id: v.id, status: 'ok', km: r.km, cost: r.cost, per_km: r.perKm } : { vehicle_id: v.id, status: r.status };
      });
    let km = 0;
    let cost = 0;
    for (const p of perVehicle) {
      if (p.status !== 'ok') continue;
      km += p.km;
      cost += p.cost;
    }
    report.per_km = { total: km > 0 ? { km, cost: cents(cost), per_km: cents(cost / km) } : null, per_vehicle: perVehicle };
  }

  if (has('reports_advanced')) {
    const avg = report.by_vehicle.length ? report.by_vehicle.reduce((s, g) => s + g.total, 0) / report.by_vehicle.length : 0;
    report.advanced = {
      high_cost: report.by_vehicle.length > 1 ? report.by_vehicle.filter((g) => g.total > avg * 1.5).map((g) => g.key) : [],
      previous_by_vehicle: previous
        ? [...groupBy(scoped.filter(inside(previous)), (e) => e.vehicle_id)].map(([k, l]) => ({ key: k, total: sum(l) })).sort((a, b) => a.key.localeCompare(b.key))
        : [],
      vehicle_monthly: [...new Set(scoped.map((e) => e.vehicle_id))].sort().map((id) => ({
        vehicle_id: id,
        months: months.map((m) => ({ month: m, total: sum(scoped.filter((e) => e.vehicle_id === id && e.day.startsWith(m))) })),
      })),
    };
  }
  return report;
}
