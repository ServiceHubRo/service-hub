import type { Database } from './database.types';
import { ensureChanged } from './directWrite';
import { call, failure, RpcError } from './rpc';
import { supabase } from './supabase';

/**
 * The client's garage (FR §3.4, P7; T07). Cars are the client's own rows: RLS lets nobody else —
 * not even the shops they book with — read them. Bookings keep their own snapshot of the car, so
 * editing or deleting a car here never changes a booking.
 */

export type Car = Database['public']['Tables']['cars']['Row'];

export interface CarFields {
  make: string;
  model: string;
  year: number | null;
  plate: string | null;
  vin: string | null;
  itp_expiry: string | null;
  rca_expiry: string | null;
  vignette_expiry: string | null;
  /** T30: how often the owner changes the oil (months, 1–24); null = the catalog's interval. */
  oil_change_months: number | null;
  /** T30: the last oil change, when made outside Service-Hub (no later than today). */
  last_oil_change: string | null;
}

const COLUMNS = 'id, make, model, year, plate, plate_norm, vin, itp_expiry, rca_expiry, vignette_expiry, oil_change_months, last_oil_change, created_at, updated_at, owner_id, reminded';

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

/** Oldest first, so a car keeps its place in the list. */
export async function fetchCars(): Promise<Car[]> {
  const { data, error } = await db().from('cars').select(COLUMNS).order('created_at').order('id');
  if (error) throw failure(error);
  return data;
}

export async function fetchCar(id: string): Promise<Car | null> {
  const { data, error } = await db().from('cars').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw failure(error);
  return data;
}

/**
 * Adds a car under an id the form made once (CLAUDE.md §6.7): if an earlier attempt went through
 * but its answer was lost, the retry hits the primary key and returns the row already saved.
 */
export async function createCar(id: string, fields: CarFields): Promise<Car> {
  const { data, error } = await db().from('cars').insert({ id, ...fields }).select(COLUMNS).single();
  if (!error) return data;
  if ((error as { code?: string }).code === '23505') {
    const saved = await fetchCar(id);
    if (saved) return saved;
  }
  throw failure(error);
}

export async function updateCar(id: string, fields: CarFields): Promise<Car> {
  const { data, error } = await db().from('cars').update(fields).eq('id', id).select(COLUMNS).maybeSingle();
  if (error) throw failure(error);
  if (!data) throw new RpcError('car_not_found');
  return data;
}

/**
 * The catalog's oil-change interval (T30) for the Garage's "Standard": null when the catalog has
 * none, or the oil change is switched off (then no oil reminder goes, whatever the client set).
 */
export async function fetchOilStandard(): Promise<{ enabled: boolean; months: number | null }> {
  const { data, error } = await db().from('services').select('enabled, reminder_months').eq('id', 'ulei').maybeSingle();
  if (error) throw failure(error);
  return { enabled: data?.enabled ?? false, months: data?.reminder_months ?? null };
}

/**
 * Deleting twice is harmless: the second time there is simply nothing left to delete. A deletion the
 * database refuses (a suspended account) is an error, never a silent success (A7).
 */
export async function deleteCar(id: string): Promise<void> {
  await ensureChanged(await db().from('cars').delete().eq('id', id).select('id'), () =>
    db().from('cars').select('id').eq('id', id),
  );
}

/** The owner keeps one of two copies of the same car (T66): bookings and reports move to it; logged. */
export async function mergeCars(keepId: string, dropId: string, requestId: string): Promise<void> {
  await call('merge_cars', { p_keep: keepId, p_drop: dropId, p_request_id: requestId });
}

export interface DuplicateCar {
  id: string;
  make: string;
  model: string;
  plate: string | null;
  vin: string | null;
  bookings: number;
}

export interface VehicleDuplicates {
  personal: { owner_id: string; email: string | null; key: string; cars: DuplicateCar[] }[];
  company: { company_id: string; company: string | null; vin: string; vehicles: Omit<DuplicateCar, 'vin' | 'bookings'>[] }[];
}

/** The platform admin's list of copies (T66): read only; the owners merge their own cars. */
export async function adminVehicleDuplicates(): Promise<VehicleDuplicates> {
  return (await call('admin_vehicle_duplicates', {} as never)) as unknown as VehicleDuplicates;
}
