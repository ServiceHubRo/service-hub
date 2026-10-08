import type { ServiceArea } from '../lib/areas';
import { call, failure, RpcError } from './rpc';
import { supabase } from './supabase';

/**
 * Zones and the client's waiting list (Eduard, 8 Oct). The list is written only through
 * join_area_waitlist / leave_area_waitlist; the client reads their own row (RLS).
 */

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

export async function fetchServiceAreas(): Promise<ServiceArea[]> {
  return (await call('list_service_areas', {} as never)) as unknown as ServiceArea[];
}

export interface WaitlistEntry {
  area: string;
  locality: string | null;
  categories: string[];
  created_at: string;
  notified_at: string | null;
}

export async function fetchMyWaitlist(): Promise<WaitlistEntry | null> {
  const { data, error } = await db()
    .from('area_waitlist')
    .select('area, locality, categories, created_at, notified_at')
    .maybeSingle();
  if (error) throw failure(error);
  return data;
}

export async function joinAreaWaitlist(
  input: { area: string; locality: string | null; categories: string[] },
  requestId: string,
): Promise<WaitlistEntry> {
  const result = await call('join_area_waitlist', {
    p_area: input.area,
    p_locality: input.locality ?? '',
    p_categories: input.categories,
    p_request_id: requestId,
  });
  return result as unknown as WaitlistEntry;
}

export async function leaveAreaWaitlist(requestId: string): Promise<void> {
  await call('leave_area_waitlist', { p_request_id: requestId });
}

// ------------------------------------------------------------------------------------ admin

export type AreaMode = 'auto' | 'on' | 'off';

export interface AdminArea {
  code: string;
  name_ro: string;
  name_en: string;
  mode: AreaMode;
  live: boolean;
  launched_at: string | null;
  shops_public: number;
  shops_total: number;
  waiting: number;
  notified: number;
  categories: { key: string; count: number }[];
  localities: { name: string; count: number }[];
}

export interface AdminAreas {
  areas: AdminArea[];
  /** Shops whose address names no zone we know. */
  unplaced: { id: string; name: string; city: string; county: string | null }[];
}

export async function fetchAdminAreas(): Promise<AdminAreas> {
  return (await call('admin_list_service_areas', {} as never)) as unknown as AdminAreas;
}

export async function setAreaMode(
  code: string,
  mode: AreaMode,
  requestId: string,
): Promise<{ code: string; mode: AreaMode; live: boolean; notified: number }> {
  const r = await call('admin_set_area_mode', { p_code: code, p_mode: mode, p_request_id: requestId });
  return r as unknown as { code: string; mode: AreaMode; live: boolean; notified: number };
}
