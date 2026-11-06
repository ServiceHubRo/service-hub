/**
 * The maintenance plans of the company vehicles (M4). The status is computed by the database
 * (fleet_maintenance_status) from the latest odometer value and the date; the screen only shows it.
 */

export const MAINTENANCE_KINDS = ['oil', 'filters', 'brakes', 'tires', 'battery', 'fluids', 'service', 'custom'] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];
export type MaintenanceStatus = 'ok' | 'soon' | 'overdue' | 'insufficient_data';
export type MaintenanceReason = 'no_last_done_km' | 'no_last_done_on' | 'no_reading' | 'reading_old' | 'reading_before_service';

export interface MaintenanceState {
  status: MaintenanceStatus;
  reasons: MaintenanceReason[];
  km_status: MaintenanceStatus | null;
  km_left: number | null;
  due_km: number | null;
  reading_km: number | null;
  reading_day: string | null;
  month_status: MaintenanceStatus | null;
  due_on: string | null;
  days_left: number | null;
}

export interface FleetMaintenanceItem {
  id: string;
  vehicle_id: string;
  kind: MaintenanceKind;
  label: string | null;
  interval_km: number | null;
  interval_months: number | null;
  last_done_on: string | null;
  last_done_km: number | null;
  last_booking_id: string | null;
  created_at: string;
  updated_at: string | null;
  state: MaintenanceState;
}

export interface MaintenanceFields {
  vehicle_id: string;
  kind: MaintenanceKind;
  label: string | null;
  interval_km: number | null;
  interval_months: number | null;
  last_done_on: string | null;
  last_done_km: number | null;
}

/** Overdue first, then soon, then missing data, then ok. */
const ORDER: Record<MaintenanceStatus, number> = { overdue: 0, soon: 1, insufficient_data: 2, ok: 3 };

export function sortMaintenance(items: readonly FleetMaintenanceItem[]): FleetMaintenanceItem[] {
  return [...items].sort((a, b) => ORDER[a.state.status] - ORDER[b.state.status] || a.created_at.localeCompare(b.created_at));
}

/** What needs attention (the dashboard's „Termene apropiate”). */
export function maintenanceDue(items: readonly FleetMaintenanceItem[]): FleetMaintenanceItem[] {
  return sortMaintenance(items.filter((i) => i.state.status === 'overdue' || i.state.status === 'soon'));
}
