import type { Database } from './database.types';
import { call, failure, RpcError } from './rpc';
import { supabase } from './supabase';
import type { ImportRow } from '../lib/importRows';

/**
 * A shop's import from another program (T31a; migration `shop_import`): begun once, filled in
 * chunks, undone as a whole. Owner only — the database refuses anyone else. The shop's clients
 * and cars it brought are read back here when a booking is added by phone.
 */

export type ShopImport = Database['public']['Tables']['shop_imports']['Row'];

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

export function beginImport(fileName: string, requestId: string): Promise<ShopImport> {
  return call('shop_import_begin', { p_file_name: fileName, p_request_id: requestId });
}

export function addImportRows(importId: string, rows: readonly ImportRow[], requestId: string): Promise<ShopImport> {
  return call('shop_import_add', { p_import_id: importId, p_rows: rows as never, p_request_id: requestId });
}

export function undoImport(importId: string, requestId: string): Promise<ShopImport> {
  return call('shop_import_undo', { p_import_id: importId, p_request_id: requestId });
}

/** The shop's imports, newest first (the undone ones too). */
export async function fetchImports(): Promise<ShopImport[]> {
  const { data, error } = await db().from('shop_imports').select('*').order('created_at', { ascending: false }).limit(20);
  if (error) throw failure(error);
  return data;
}

export interface KnownCar {
  make: string;
  model: string;
  year: number | null;
  plate: string | null;
}

export interface KnownClient {
  name: string;
  email: string | null;
  cars: KnownCar[];
}

/** A client of the shop by phone (`+40…`), with their cars, or null. */
export async function findShopClient(phone: string): Promise<KnownClient | null> {
  const { data, error } = await db()
    .from('shop_clients')
    .select('name, email, shop_client_cars(make, model, year, plate)')
    .eq('phone', phone)
    .maybeSingle();
  if (error) throw failure(error);
  if (!data) return null;
  return { name: data.name, email: data.email, cars: data.shop_client_cars ?? [] };
}
