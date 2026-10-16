import { call, failure, RpcError } from './rpc';
import { supabase } from './supabase';

/**
 * "Anunță-mă dacă se eliberează un loc" (T37b): the full days of a shop the client waits for.
 * Written only through join_slot_waitlist / leave_slot_waitlist; the client reads their own rows.
 */

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

/** The days of this shop the client is still waiting for (not told yet). */
export async function fetchWaitedDays(shopId: string): Promise<Set<string>> {
  const { data, error } = await db().from('slot_waitlist').select('date').eq('shop_id', shopId).is('notified_at', null);
  if (error) throw failure(error);
  return new Set((data ?? []).map((r) => r.date));
}

export async function joinSlotWaitlist(shopId: string, date: string, requestId: string): Promise<void> {
  await call('join_slot_waitlist', { p_shop_id: shopId, p_date: date, p_request_id: requestId });
}

export async function leaveSlotWaitlist(shopId: string, date: string, requestId: string): Promise<void> {
  await call('leave_slot_waitlist', { p_shop_id: shopId, p_date: date, p_request_id: requestId });
}
