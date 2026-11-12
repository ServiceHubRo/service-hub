import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { call, failure, FILE_ERRORS, FileError, RpcError, type Booking, type FileErrorCode } from './rpc';
import { supabase } from './supabase';
import type { ExpenseFields, FleetExpense, FleetIssue, FleetMaintenanceItem, MaintenanceFields, FleetReading, FuelStats, FleetIssueDetail, FleetOverview, IssueFields, IssueUpdate, FleetPlanRow, FleetPlanSummary, FleetReport, FleetSubscriptionView, FleetVehicle, ReportFilters } from '../lib/fleet';

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

// ------------------------------------------------------------------------------------ bookings (T63d)

/** The company's answer to a quote: admin, or a manager up to the company's limit. */
export async function fleetDecideQuote(bookingId: string, quoteId: string, approvedItemIds: string[], requestId: string): Promise<Booking> {
  return (await call('fleet_decide_quote', {
    p_booking_id: bookingId,
    p_quote_id: quoteId,
    p_approved_item_ids: approvedItemIds,
    p_request_id: requestId,
  } as never)) as unknown as Booking;
}

export interface BookableVehicle {
  id: string;
  make: string;
  model: string;
  year: number | null;
  plate: string | null;
}

export interface BookableCompany {
  company_id: string;
  company_name: string;
  read_only: boolean;
  vehicles: BookableVehicle[];
}

/** The company vehicles the caller may book (a driver: the one assigned), for the car step. */
export async function fetchBookableVehicles(): Promise<BookableCompany[]> {
  return (await call('fleet_bookable_vehicles', {} as never)) as unknown as BookableCompany[];
}

// ------------------------------------------------------------------------------------ reports (T65)

/** The plans sold today, in order (every signed-in user reads them): the "Disponibil în …" tags. */
export async function fetchFleetPlans(): Promise<FleetPlanRow[]> {
  if (!supabase) throw new RpcError('network');
  const { data, error } = await supabase
    .from('fleet_plans')
    .select('key, name_ro, name_en, price_ron, vehicle_limit, member_limit, features, included_members, member_price_ron')
    .eq('public', true)
    .eq('active', true)
    .order('position');
  if (error) throw failure(error);
  return data as unknown as FleetPlanRow[];
}

/** A report computed by the database for the company's plan and the member's role. */
export async function fetchFleetReport(
  company: string,
  range: { from: string | null; to: string },
  previous: { from: string | null; to: string } | null,
  filters: ReportFilters,
): Promise<FleetReport> {
  return (await call('fleet_report', {
    p_company: company,
    p_from: range.from,
    p_to: range.to,
    p_prev_from: previous?.from ?? null,
    p_prev_to: previous?.to ?? null,
    p_filters: filters,
  } as never)) as unknown as FleetReport;
}

/** Checks that the plan and the role allow an export, and logs it; the file is written afterwards. */
export async function logFleetExport(company: string, kind: 'vehicles_csv' | 'costs_csv' | 'report_csv' | 'report_xlsx', rows: number): Promise<void> {
  await call('fleet_log_export', { p_company: company, p_kind: kind, p_rows: rows } as never);
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

export async function adminSetCompanyPlan(company: string, planKey: string, reason: string, requestId: string): Promise<void> {
  await call('admin_set_company_plan', { p_company: company, p_plan_key: planKey, p_request_id: requestId, p_reason: reason });
}

export async function adminExtendCompanyTrial(company: string, days: number, reason: string, requestId: string): Promise<void> {
  await call('admin_extend_company_trial', { p_company: company, p_days: days, p_request_id: requestId, p_reason: reason });
}

export async function adminUpdateFleetPlan(
  key: string,
  v: { price: number | null; vehicleLimit: number | null; includedMembers: number | null; memberPrice: number | null },
  requestId: string,
): Promise<void> {
  await call('admin_update_fleet_plan', {
    p_key: key,
    p_price_ron: v.price,
    p_vehicle_limit: v.vehicleLimit,
    p_included_members: v.includedMembers,
    p_member_price_ron: v.memberPrice,
    p_request_id: requestId,
  } as never);
}

// ------------------------------------------------------------------------------------ expenses (M1)

/** Adds (expense null) or changes an expense; the database checks the rights, the fields and duplicates. */
export async function saveExpense(company: string, expense: string | null, fields: ExpenseFields, requestId: string): Promise<FleetExpense> {
  return (await call('fleet_save_expense', {
    p_company: company,
    p_expense: expense,
    p_fields: fields,
    p_request_id: requestId,
  } as never)) as unknown as FleetExpense;
}

/** Deletes an expense (recoverable: kept with the date it was deleted, and in the company log). */
export async function deleteExpense(expense: string, requestId: string): Promise<void> {
  await call('fleet_delete_expense', { p_expense: expense, p_request_id: requestId } as never);
}

/** „Verificată” / „De verificat”. */
export async function markExpense(expense: string, status: 'ok' | 'to_check', requestId: string): Promise<FleetExpense> {
  return (await call('fleet_mark_expense', { p_expense: expense, p_status: status, p_request_id: requestId } as never)) as unknown as FleetExpense;
}

export const FLEET_FILES_BUCKET = 'fleet-files';
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * A6 (M4): every company file goes through the Edge Function fleet-files, which checks its real type
 * from the bytes, refuses active or encrypted PDFs, removes the metadata of photos (GPS included) and
 * applies the limits; the bucket takes nothing else. Answers the stored path.
 */
async function uploadFleetFile(company: string, vehicle: string, issue: string | null, file: File): Promise<string> {
  if (!supabase) throw new RpcError('network');
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('company', company);
  form.append('vehicle', vehicle);
  if (issue) form.append('issue', issue);
  const { data, error } = await supabase.functions.invoke('fleet-files', { method: 'POST', body: form });
  if (!error) {
    const path = (data as { path?: unknown } | null)?.path;
    if (typeof path !== 'string') throw new RpcError('unknown');
    return path;
  }
  if (error instanceof FunctionsFetchError) throw new RpcError('network');
  if (error instanceof FunctionsHttpError) {
    let code: unknown;
    try {
      code = ((await (error.context as Response).json()) as { error?: unknown }).error;
    } catch {
      code = null;
    }
    if ((FILE_ERRORS as readonly unknown[]).includes(code)) throw new FileError(code as FileErrorCode);
    throw failure({ message: code }, 'fleet-files');
  }
  throw new RpcError('unknown');
}

/** The photo or PDF of a receipt, uploaded before the expense is saved (`<company>/<vehicle>/<random>.<ext>`). */
export function uploadReceipt(company: string, vehicle: string, file: File): Promise<string> {
  return uploadFleetFile(company, vehicle, null, file);
}

/** A link to look at a receipt (60 seconds, as every company file). */
export async function receiptUrl(path: string): Promise<string> {
  return fleetFileUrl(path);
}

/** A link to look at a file of the company (receipt or incident photo), valid for 60 seconds: a member
 * whose access is revoked cannot keep using an old one. */
export async function fleetFileUrl(path: string): Promise<string> {
  if (!supabase) throw new RpcError('network');
  const { data, error } = await supabase.storage.from(FLEET_FILES_BUCKET).createSignedUrl(path, 60);
  if (error || !data) throw new RpcError('unknown');
  return data.signedUrl;
}

// ------------------------------------------------------------------------------------ issues (M3)

export const ISSUE_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ISSUE_PHOTO_MAX = 6;

/** A photo of a report, uploaded before the report is sent (`<company>/<vehicle>/issues/<issue>/<random>.<ext>`). */
export function uploadIssuePhoto(company: string, vehicle: string, issue: string, file: File): Promise<string> {
  return uploadFleetFile(company, vehicle, issue, file);
}

export async function reportIssue(company: string, issue: string, fields: IssueFields, requestId: string): Promise<FleetIssue> {
  return (await call('fleet_report_issue', { p_company: company, p_issue: issue, p_fields: fields, p_request_id: requestId } as never)) as unknown as FleetIssue;
}

export async function updateIssue(issue: string, fields: IssueUpdate, requestId: string): Promise<FleetIssue> {
  return (await call('fleet_update_issue', { p_issue: issue, p_fields: fields, p_request_id: requestId } as never)) as unknown as FleetIssue;
}

export async function fetchIssueDetail(issue: string): Promise<FleetIssueDetail> {
  return (await call('fleet_issue_detail', { p_issue: issue } as never)) as unknown as FleetIssueDetail;
}

// ------------------------------------------------------------------------------------ odometer (M2)

export async function addReading(company: string, vehicle: string, day: string, km: number, requestId: string): Promise<FleetReading> {
  return (await call('fleet_add_reading', { p_company: company, p_vehicle: vehicle, p_day: day, p_km: km, p_request_id: requestId } as never)) as unknown as FleetReading;
}

export async function correctReading(reading: string, km: number, reason: string, requestId: string): Promise<FleetReading> {
  return (await call('fleet_correct_reading', { p_reading: reading, p_km: km, p_reason: reason, p_request_id: requestId } as never)) as unknown as FleetReading;
}

export async function ignoreJobOdometer(booking: string, reason: string, requestId: string): Promise<void> {
  await call('fleet_ignore_job_odometer', { p_booking: booking, p_reason: reason, p_request_id: requestId } as never);
}

export async function fetchFuelStats(company: string, vehicle: string, from: string | null, to: string): Promise<FuelStats> {
  return (await call('fleet_fuel_stats', { p_company: company, p_vehicle: vehicle, p_from: from, p_to: to } as never)) as unknown as FuelStats;
}

// ------------------------------------------------------------------------------------ quote changes, cancel (M5)

export async function fleetCancelBooking(booking: string, reason: string, requestId: string): Promise<Booking> {
  return (await call('fleet_cancel_booking', { p_booking_id: booking, p_reason: reason, p_request_id: requestId } as never)) as unknown as Booking;
}

export async function fleetRequestQuoteChanges(booking: string, quote: string, reason: string, requestId: string): Promise<Booking> {
  return (await call('fleet_request_quote_changes', { p_booking_id: booking, p_quote_id: quote, p_reason: reason, p_request_id: requestId } as never)) as unknown as Booking;
}

// ------------------------------------------------------------------------------------ maintenance (M4)

export async function saveMaintenance(company: string, item: string | null, fields: MaintenanceFields, requestId: string): Promise<FleetMaintenanceItem> {
  return (await call('fleet_save_maintenance', { p_company: company, p_item: item, p_fields: fields, p_request_id: requestId } as never)) as unknown as FleetMaintenanceItem;
}

export async function deleteMaintenance(item: string, requestId: string): Promise<void> {
  await call('fleet_delete_maintenance', { p_item: item, p_request_id: requestId } as never);
}

/** Done on a day at a km, or by a finished Service-Hub job of the vehicle. */
export async function markMaintenanceDone(item: string, fields: { day?: string; km?: number | null; booking_id?: string }, requestId: string): Promise<FleetMaintenanceItem> {
  return (await call('fleet_mark_maintenance_done', { p_item: item, p_fields: fields, p_request_id: requestId } as never)) as unknown as FleetMaintenanceItem;
}

// ------------------------------------------------------------------------------------ failed fleet notifications (M6, admin)

export interface FailedFleetEvent {
  id: number;
  event: string;
  company_name: string;
  created_at: string;
  attempts: number;
  last_error_code: string | null;
  failed_at: string;
}

export async function adminFailedFleetEvents(): Promise<FailedFleetEvent[]> {
  return (await call('admin_list_failed_fleet_events', {} as never)) as unknown as FailedFleetEvent[];
}

export async function adminRetryFleetEvent(id: number, requestId: string): Promise<void> {
  await call('admin_retry_fleet_event', { p_id: id, p_request_id: requestId } as never);
}
