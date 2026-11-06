import type { FleetCapability } from './permissions';
import type { FleetVehicle } from './types';

/**
 * Whether a member may report an issue on this vehicle (M3), as fleet_issue_can_report() decides on
 * the server: issues.manage on any active vehicle; issues.report on a vehicle the member sees
 * (vehicles.viewAll, or the vehicle assigned to them). Archived vehicles take no report.
 */
export function canReportOn(v: Pick<FleetVehicle, 'archived_at' | 'driver_id'>, allowed: (c: FleetCapability) => boolean, memberId: string): boolean {
  if (v.archived_at) return false;
  if (allowed('issues.manage')) return true;
  return allowed('issues.report') && (allowed('vehicles.viewAll') || v.driver_id === memberId);
}
