import { jobEndDay } from './costs';
import type { FleetJob } from './types';

/**
 * The odometer log of a company vehicle (M2): the readings kept by the database (typed in, from
 * expenses, from maintenance, imported) and the finished Service-Hub jobs with km (read from the
 * bookings). The chronological rule is the database's; here the log is put together for the screen and
 * a step of more than 2,000 km a day is marked „Anomalie – de verificat” (never refused).
 */

export type ReadingSource = 'manual' | 'expense' | 'maintenance' | 'import';

export interface FleetReading {
  id: string;
  vehicle_id: string;
  day: string;
  km: number;
  source: ReadingSource;
  ref_id: string | null;
  corrected_from: number | null;
  correction_reason: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface IgnoredJob {
  booking_id: string;
  reason: string;
  at: string;
}

export type ImportReason = 'below_earlier' | 'above_later' | 'jump';

/** A receipt the import could not take (vehicles.manage sees them). */
export interface OdometerException {
  expense_id: string;
  vehicle_id: string;
  day: string;
  km: number;
  reasons: ImportReason[];
}

export interface LogEntry {
  key: string;
  day: string;
  km: number;
  source: ReadingSource | 'job';
  reading: FleetReading | null;
  job: FleetJob | null;
  /** A job whose km the company left out of the rule. */
  ignored: boolean;
  /** More than JUMP_KM_PER_DAY since the entry before it. */
  anomaly: boolean;
}

export const JUMP_KM_PER_DAY = 2000;

function dayNumber(ymd: string): number {
  return Math.round(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86_400_000);
}

/** Newest first. The anomaly compares each counted entry with the counted one before it (by day). */
export function odometerLog(vehicleId: string, readings: readonly FleetReading[], jobs: readonly FleetJob[], ignored: readonly IgnoredJob[]): LogEntry[] {
  const skip = new Set(ignored.map((i) => i.booking_id));
  const all: LogEntry[] = [
    ...readings
      .filter((r) => r.vehicle_id === vehicleId)
      .map((r) => ({ key: `r:${r.id}`, day: r.day, km: r.km, source: r.source, reading: r, job: null, ignored: false, anomaly: false })),
    ...jobs
      .filter((j) => j.vehicle_id === vehicleId && j.status === 'done' && j.odometer !== null)
      .map((j) => ({ key: `j:${j.id}`, day: jobEndDay(j), km: j.odometer!, source: 'job' as const, reading: null, job: j, ignored: skip.has(j.id), anomaly: false })),
  ];
  all.sort((a, b) => a.day.localeCompare(b.day) || a.km - b.km || a.key.localeCompare(b.key));
  let prev: LogEntry | null = null;
  for (const e of all) {
    if (e.ignored) continue;
    if (prev && e.day > prev.day && (e.km - prev.km) / (dayNumber(e.day) - dayNumber(prev.day)) > JUMP_KM_PER_DAY) e.anomaly = true;
    prev = e;
  }
  return all.reverse();
}

/** The latest km the log knows (ignored jobs left out); null when there is none. */
export function latestKm(log: readonly LogEntry[]): number | null {
  const counted = log.filter((e) => !e.ignored);
  if (counted.length === 0) return null;
  return counted.reduce((best, e) => (e.day > best.day || (e.day === best.day && e.km > best.km) ? e : best)).km;
}

/** fleet_fuel_stats: consumption only between full tanks, cost per km only with two readings. */
export interface FuelStats {
  status: 'ok' | 'insufficient_data' | 'not_supported';
  consumption?: number | null;
  segments?: { from_day: string; to_day: string; km: number; liters: number | null; l_per_100: number | null; reason: string | null }[];
  reasons: string[];
  km_in_range?: number | null;
  fuel_cost?: number | null;
  cost_per_km?: number | null;
}
