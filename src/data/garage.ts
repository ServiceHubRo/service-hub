import type { Database } from './database.types';
import { failure, RpcError } from './rpc';
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
}

const COLUMNS = 'id, make, model, year, plate, plate_norm, vin, itp_expiry, rca_expiry, vignette_expiry, created_at, updated_at, owner_id, reminded';

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

/** Deleting twice is harmless: the second time there is simply nothing left to delete. */
export async function deleteCar(id: string): Promise<void> {
  const { error } = await db().from('cars').delete().eq('id', id);
  if (error) throw failure(error);
}
