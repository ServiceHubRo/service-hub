import { jobEndDay, sumAmounts, type CostEntry, type DayRange } from './costs';
import type { FleetExpense, FleetJob } from './types';

/**
 * Cost per kilometre (docs/FLEET_PLAN.md §5.4). The distance comes only from odometer readings the
 * platform holds: finished Service-Hub jobs and expenses typed in with a reading. A figure is given
 * only when it can be checked:
 *
 *  - baseline = the last reading on or before the first day of the range, else the first reading
 *    inside it; end = the last reading inside the range;
 *  - distance = end − baseline, which must be above 0;
 *  - the costs counted are those after the baseline's day, from the range's first day, up to the
 *    end reading's day (a cost after the last reading has no kilometres to divide by yet);
 *  - readings that go down over time make the whole car `inconsistent` — no figure at all.
 */

export interface Reading {
  day: string;
  km: number;
}

export type CostPerKm =
  | { status: 'ok'; km: number; cost: number; perKm: number; from: Reading; to: Reading }
  | { status: 'no_readings' | 'one_reading' | 'inconsistent' | 'no_distance' };

export function readingsOf(vehicleId: string, jobs: readonly FleetJob[], expenses: readonly FleetExpense[]): Reading[] {
  const out: Reading[] = [];
  for (const j of jobs) {
    if (j.vehicle_id === vehicleId && j.status === 'done' && j.odometer !== null) out.push({ day: jobEndDay(j), km: j.odometer });
  }
  for (const e of expenses) {
    if (e.vehicle_id === vehicleId && !e.deleted_at && e.odometer !== null) out.push({ day: e.day, km: e.odometer });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.km - b.km);
}

/** Readings sorted by day: a later day with fewer kilometres means one of them is wrong. */
export function consistent(readings: readonly Reading[]): boolean {
  for (let i = 1; i < readings.length; i++) {
    if (readings[i]!.km < readings[i - 1]!.km) return false;
  }
  return true;
}

export function costPerKm(readings: readonly Reading[], costs: readonly CostEntry[], range: DayRange): CostPerKm {
  if (!consistent(readings)) return { status: 'inconsistent' };
  const inside = readings.filter((r) => (range.from === null || r.day >= range.from) && r.day <= range.to);
  if (inside.length === 0) return { status: 'no_readings' };
  const before = range.from === null ? [] : readings.filter((r) => r.day < range.from!);
  const from = before.length > 0 ? before[before.length - 1]! : inside[0]!;
  const to = inside[inside.length - 1]!;
  if (from === to) return { status: 'one_reading' };
  const km = to.km - from.km;
  if (km <= 0) return { status: 'no_distance' };
  const counted = costs.filter((c) => c.day > from.day && (range.from === null || c.day >= range.from) && c.day <= to.day);
  const cost = sumAmounts(counted);
  return { status: 'ok', km, cost, perKm: Math.round((cost / km) * 100) / 100, from, to };
}

export interface FleetCostPerKm {
  /** Over the cars with a valid figure only; null when none has one. */
  total: { km: number; cost: number; perKm: number } | null;
  perVehicle: { vehicle_id: string; result: CostPerKm }[];
}

export function fleetCostPerKm(
  vehicleIds: readonly string[],
  jobs: readonly FleetJob[],
  expenses: readonly FleetExpense[],
  entries: readonly CostEntry[],
  range: DayRange,
): FleetCostPerKm {
  const perVehicle = vehicleIds.map((id) => ({
    vehicle_id: id,
    result: costPerKm(
      readingsOf(id, jobs, expenses),
      entries.filter((e) => e.vehicle_id === id),
      range,
    ),
  }));
  let km = 0;
  let cents = 0;
  for (const { result } of perVehicle) {
    if (result.status !== 'ok') continue;
    km += result.km;
    cents += Math.round(result.cost * 100);
  }
  const cost = cents / 100;
  return { total: km > 0 ? { km, cost, perKm: Math.round((cost / km) * 100) / 100 } : null, perVehicle };
}
