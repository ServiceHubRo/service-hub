import { daysFromToday, ymdInBucharest } from '../../i18n/format';
import { CAR_DOCS, urgencyOf, type CarDoc, type Urgency } from '../expiry';
import { normalizePlate } from '../history';
import { matchesWords, searchWords } from '../text';
import type { BookingStatus } from '../status';
import { jobEndDay, sumAmounts, type CostEntry, type DayRange, inRange } from './costs';
import { readingsOf } from './costPerKm';
import type { FleetExpense, FleetJob, FleetVehicle } from './types';

/**
 * The fleet's cars (docs/FLEET_PLAN.md §4): the status each one is in, the search, filters and
 * sorting of the Vehicule page, and the documents that need attention. A status is shown only when
 * the rows prove it: `in_service` and `scheduled` come from the car's bookings, `unavailable` only
 * from a manager's explicit mark, `archived` from the archive date.
 */

export type VehicleStatus = 'active' | 'scheduled' | 'in_service' | 'unavailable' | 'archived';
export const VEHICLE_STATUSES: readonly VehicleStatus[] = ['active', 'scheduled', 'in_service', 'unavailable', 'archived'];

const AT_SHOP: ReadonlySet<BookingStatus> = new Set(['in_inspection', 'quote_sent', 'approved', 'in_progress']);
const BOOKED: ReadonlySet<BookingStatus> = new Set(['pending', 'confirmed']);

export function vehicleStatus(vehicle: FleetVehicle, jobs: readonly FleetJob[]): VehicleStatus {
  if (vehicle.archived_at) return 'archived';
  const mine = jobs.filter((j) => j.vehicle_id === vehicle.id);
  if (mine.some((j) => AT_SHOP.has(j.status))) return 'in_service';
  if (vehicle.unavailable) return 'unavailable';
  if (mine.some((j) => BOOKED.has(j.status))) return 'scheduled';
  return 'active';
}

/**
 * The car's latest known odometer reading: finished Service-Hub jobs and expenses typed in with a
 * reading (the same readings as the cost per km); null when there is none.
 */
export function lastOdometer(vehicleId: string, jobs: readonly FleetJob[], expenses: readonly FleetExpense[] = []): number | null {
  const readings = readingsOf(vehicleId, jobs, expenses);
  return readings.length > 0 ? readings[readings.length - 1]!.km : null;
}

export function lastServiceDay(vehicleId: string, jobs: readonly FleetJob[]): string | null {
  let best: string | null = null;
  for (const j of jobs) {
    if (j.vehicle_id !== vehicleId || j.status !== 'done') continue;
    const day = jobEndDay(j);
    if (!best || day > best) best = day;
  }
  return best;
}

export interface VehicleRow {
  vehicle: FleetVehicle;
  status: VehicleStatus;
  odometer: number | null;
  /** Costs in the chosen range (null when the caller may not see costs). */
  cost: number | null;
  lastService: string | null;
}

export function vehicleRows(
  vehicles: readonly FleetVehicle[],
  jobs: readonly FleetJob[],
  entries: readonly CostEntry[] | null,
  range: DayRange,
  expenses: readonly FleetExpense[] = [],
): VehicleRow[] {
  return vehicles.map((v) => ({
    vehicle: v,
    status: vehicleStatus(v, jobs),
    odometer: lastOdometer(v.id, jobs, expenses),
    cost: entries ? sumAmounts(entries.filter((e) => e.vehicle_id === v.id && inRange(e.day, range))) : null,
    lastService: lastServiceDay(v.id, jobs),
  }));
}

export interface VehicleFilter {
  query: string;
  /** `all` hides archived cars; `archived` shows only them. */
  status: VehicleStatus | 'all';
  driverId: string | null;
  department: string | null;
  vehicleType: string | null;
}

export const NO_FILTER: VehicleFilter = { query: '', status: 'all', driverId: null, department: null, vehicleType: null };

/** Every word of the search in the plate (as typed or without spaces), make, model or VIN. */
export function matchesVehicle(v: FleetVehicle, query: string): boolean {
  const words = searchWords(query);
  if (words.length === 0) return true;
  return matchesWords(words, v.plate ?? '', normalizePlate(v.plate), v.make, v.model, v.vin ?? '', String(v.year ?? ''));
}

export function filterVehicles(rows: readonly VehicleRow[], f: VehicleFilter): VehicleRow[] {
  return rows.filter(
    (r) =>
      (f.status === 'all' ? r.status !== 'archived' : r.status === f.status) &&
      (f.driverId === null || r.vehicle.driver_id === f.driverId) &&
      (f.department === null || r.vehicle.department === f.department) &&
      (f.vehicleType === null || r.vehicle.vehicle_type === f.vehicleType) &&
      matchesVehicle(r.vehicle, f.query),
  );
}

export type VehicleSort = 'plate' | 'cost' | 'odometer' | 'added' | 'lastService';
export const VEHICLE_SORTS: readonly VehicleSort[] = ['plate', 'cost', 'odometer', 'added', 'lastService'];

/** Plates A→Z; costs, kilometres and dates largest/newest first; missing values always last. */
export function sortVehicles(rows: readonly VehicleRow[], sort: VehicleSort): VehicleRow[] {
  const plate = (r: VehicleRow) => normalizePlate(r.vehicle.plate) || `~${r.vehicle.make} ${r.vehicle.model}`;
  const desc = <T>(value: (r: VehicleRow) => T | null, cmp: (a: T, b: T) => number) => (a: VehicleRow, b: VehicleRow) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return plate(a).localeCompare(plate(b));
    if (va === null) return 1;
    if (vb === null) return -1;
    return cmp(vb, va) || plate(a).localeCompare(plate(b));
  };
  const num = (a: number, b: number) => a - b;
  const str = (a: string, b: string) => a.localeCompare(b);
  const compare: Record<VehicleSort, (a: VehicleRow, b: VehicleRow) => number> = {
    plate: (a, b) => plate(a).localeCompare(plate(b)),
    cost: desc((r) => r.cost, num),
    odometer: desc((r) => r.odometer, num),
    added: desc((r) => r.vehicle.created_at, str),
    lastService: desc((r) => r.lastService, str),
  };
  return [...rows].sort(compare[sort]);
}

/** The distinct non-empty values of a column, A→Z (the department and type filters). */
export function distinctValues(vehicles: readonly FleetVehicle[], column: 'department' | 'vehicle_type'): string[] {
  return [...new Set(vehicles.map((v) => v[column]).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
}

// ------------------------------------------------------------------ documents

export interface DocState {
  vehicle_id: string;
  doc: CarDoc;
  /** Null when the date was never entered. */
  date: string | null;
  days: number | null;
  urgency: Urgency | 'missing';
}

/** Every document of every car still in the fleet, most urgent first, missing dates last. */
export function documentStates(vehicles: readonly FleetVehicle[], now: Date = new Date()): DocState[] {
  const out: DocState[] = [];
  for (const v of vehicles) {
    if (v.archived_at) continue;
    for (const { doc, column } of CAR_DOCS) {
      const date = v[column];
      if (!date) {
        out.push({ vehicle_id: v.id, doc, date: null, days: null, urgency: 'missing' });
        continue;
      }
      const days = daysFromToday(date, now);
      out.push({ vehicle_id: v.id, doc, date, days, urgency: urgencyOf(days) });
    }
  }
  return out.sort((a, b) => (a.days ?? Number.MAX_SAFE_INTEGER) - (b.days ?? Number.MAX_SAFE_INTEGER));
}

export function needsAttention(d: DocState): boolean {
  return d.urgency === 'soon' || d.urgency === 'expired';
}

/** Today in Bucharest, `YYYY-MM-DD`. */
export function today(now: Date = new Date()): string {
  return ymdInBucharest(now);
}
