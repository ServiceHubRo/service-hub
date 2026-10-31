import { call, failure, RpcError } from './rpc';
import { supabase } from './supabase';
import type { FleetOverview, FleetPlanRow, FleetPlanSummary, FleetSubscriptionView, FleetVehicle } from '../lib/fleet';

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

// ------------------------------------------------------------------------------------ plans (T64a)

/** The plan as every member's frame needs it (badge, banners): no price. */
export async function fetchPlanSummary(company: string): Promise<FleetPlanSummary> {
  return (await call('fleet_plan_summary', { p_company: company })) as unknown as FleetPlanSummary;
}

/** The Abonament page: admin, manager and accountant (`not_allowed` for a driver). */
export async function fetchSubscription(company: string): Promise<FleetSubscriptionView> {
  return (await call('fleet_subscription', { p_company: company })) as unknown as FleetSubscriptionView;
}

// ------------------------------------------------------------------------------------ platform admin

export interface AdminFleetCompany {
  id: string;
  name: string;
  vat_id: string | null;
  created_at: string;
  archived_at: string | null;
  plan: FleetSubscriptionView['plan'];
  vehicles: number;
  members: number;
  admin_email: string | null;
}

export async function adminListFleetCompanies(): Promise<AdminFleetCompany[]> {
  return (await call('admin_list_fleet_companies', {} as never)) as unknown as AdminFleetCompany[];
}

export async function adminFleetPlans(): Promise<(FleetPlanRow & { position: number; public: boolean; active: boolean })[]> {
  if (!supabase) throw new RpcError('network');
  const { data, error } = await supabase.from('fleet_plans').select('*').order('position');
  if (error) throw failure(error);
  return data as unknown as (FleetPlanRow & { position: number; public: boolean; active: boolean })[];
}

export async function adminSetCompanyPlan(company: string, planKey: string, requestId: string): Promise<void> {
  await call('admin_set_company_plan', { p_company: company, p_plan_key: planKey, p_request_id: requestId });
}

export async function adminExtendCompanyTrial(company: string, days: number, requestId: string): Promise<void> {
  await call('admin_extend_company_trial', { p_company: company, p_days: days, p_request_id: requestId });
}

export async function adminUpdateFleetPlan(
  key: string,
  v: { price: number | null; vehicleLimit: number | null; memberLimit: number | null },
  requestId: string,
): Promise<void> {
  await call('admin_update_fleet_plan', {
    p_key: key,
    p_price_ron: v.price,
    p_vehicle_limit: v.vehicleLimit,
    p_member_limit: v.memberLimit,
    p_request_id: requestId,
  } as never);
}
