import type { Database } from './database.types';
import { failure, RpcError } from './rpc';
import { supabase } from './supabase';
import type { Lang } from '../i18n/translate';

export type Profile = Database['public']['Tables']['profiles']['Row'];

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

/** The signed-in user's own profile (RLS: own row only). Null when it does not exist. */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await db().from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw failure(error);
  return data;
}

/** Name and phone — the only identity fields the browser may change (column grants). */
export async function updateProfile(userId: string, fields: { name: string; phone: string }): Promise<Profile> {
  const { data, error } = await db().from('profiles').update(fields).eq('id', userId).select('*').single();
  if (error) throw failure(error);
  return data;
}

/** The client's reminders in Cont (T19d): review requests and service reminders, on or off. */
export async function updateReminderPrefs(
  userId: string,
  fields: { review_requests: boolean; service_reminders: boolean },
): Promise<Profile> {
  const { data, error } = await db().from('profiles').update(fields).eq('id', userId).select('*').single();
  if (error) throw failure(error);
  return data;
}

/**
 * Tells the admin lists the person uses the app (T16a). The database keeps one stamp an hour at
 * most; best effort, a failure changes nothing for the person.
 */
export async function touchLastActive(): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('touch_last_active');
  } catch {
    // offline: the next start stamps it
  }
}

export async function updateLang(userId: string, lang: Lang): Promise<void> {
  const { error } = await db().from('profiles').update({ lang }).eq('id', userId);
  if (error) throw failure(error);
}

export interface ShopSummary {
  name: string;
  city: string;
}

/** The shop this user works for (owner or staff), for the identity card in Cont. */
export async function fetchMyShop(userId: string): Promise<ShopSummary | null> {
  const { data, error } = await db()
    .from('shop_staff')
    .select('shops(name, city)')
    .eq('user_id', userId)
    .not('accepted_at', 'is', null)
    .maybeSingle();
  if (error) throw failure(error);
  return data?.shops ?? null;
}
