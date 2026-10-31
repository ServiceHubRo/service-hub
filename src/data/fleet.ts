import { call } from './rpc';
import type { FleetOverview, FleetVehicle } from '../lib/fleet';

/**
 * The company's fleet (T63c, docs/FLEET_PLAN.md): one read, `fleet_overview(company)`, already
 * narrowed to the member's role (a driver gets only the vehicles assigned to them, no money), and
 * the vehicle writes. Every write is a database function that checks the role again and logs the
 * change in the company's audit log.
 */

export async function fetchMyFleetAccess(): Promise<boolean> {
  return (await call('my_fleet_access', {} as never)) as unknown as boolean;
}

export async function fetchFleetOverview(company: string): Promise<FleetOverview> {
  const data = (await call('fleet_overview', { p_company: company })) as unknown as FleetOverview;
  // Vehicles arrive with `unavailable`, `department`, `vehicle_type`, `driver_id` as the type wants.
  return data;
}

/** What the vehicle form sends; empty text means "not set". */
export interface VehicleFields {
  make: string;
  model: string;
  year: string;
  plate: string;
  vin: string;
  itp_expiry: string;
  rca_expiry: string;
  vignette_expiry: string;
  department: string;
  vehicle_type: string;
}

export async function saveVehicle(company: string, vehicleId: string | null, fields: VehicleFields, requestId: string): Promise<FleetVehicle> {
  return (await call('fleet_save_vehicle', {
    p_company: company,
    p_vehicle: vehicleId,
    p_fields: fields,
    p_request_id: requestId,
  } as never)) as unknown as FleetVehicle;
}

export async function archiveVehicle(vehicleId: string, archived: boolean, requestId: string): Promise<FleetVehicle> {
  return (await call('fleet_archive_vehicle', { p_vehicle: vehicleId, p_archived: archived, p_request_id: requestId })) as unknown as FleetVehicle;
}

export async function assignDriver(vehicleId: string, memberId: string | null, requestId: string): Promise<FleetVehicle> {
  return (await call('fleet_assign_driver', { p_vehicle: vehicleId, p_member: memberId, p_request_id: requestId } as never)) as unknown as FleetVehicle;
}

export async function setUnavailable(vehicleId: string, unavailable: boolean, requestId: string): Promise<FleetVehicle> {
  return (await call('fleet_set_unavailable', { p_vehicle: vehicleId, p_unavailable: unavailable, p_request_id: requestId })) as unknown as FleetVehicle;
}
