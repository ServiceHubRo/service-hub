import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { call, failure, RpcError } from './rpc';
import { supabase } from './supabase';

/**
 * Shop settings (FR §4.5b, §4.6; T05). Public data, booking rules and closures are plain row
 * updates limited by column grants and RLS; the week's hours, the offered services and staff
 * invitations go through database functions so they are saved whole or not at all.
 */

type Tables = Database['public']['Tables'];
export type Shop = Tables['shops']['Row'];
export type ShopBilling = Tables['shop_billing']['Row'];
export type ShopClosure = Tables['shop_closures']['Row'];
export type ShopUpdate = Partial<
  Pick<
    Shop,
    | 'name'
    | 'description'
    | 'logo_url'
    | 'street'
    | 'city'
    | 'county'
    | 'postal_code'
    | 'phone'
    | 'phone2'
    | 'website'
    | 'facebook'
    | 'year_established'
    | 'latitude'
    | 'longitude'
    | 'daily_capacity'
    | 'cars_per_slot'
    | 'slot_minutes'
    | 'min_notice_hours'
    | 'max_advance_days'
    | 'cancel_deadline_hours'
    | 'inspection_fee'
    | 'sms_on_new_booking'
    | 'daily_digest'
    | 'capacity_reviewed_at'
    | 'billing_reminder_dismissed_at'
  >
>;
export type BillingUpdate = Partial<
  Pick<
    ShopBilling,
    'legal_name' | 'vat_id' | 'reg_com' | 'legal_address' | 'vat_payer' | 'bank_name' | 'iban' | 'billing_email' | 'legal_rep'
  >
>;

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

/** The shop the signed-in user works for (owner or staff); null when there is none. */
export async function fetchOwnShop(): Promise<Shop | null> {
  const shopId = (await call('my_shop_id', {} as never)) as string | null;
  if (!shopId) return null;
  const { data, error } = await db().from('shops').select('*').eq('id', shopId).maybeSingle();
  if (error) throw failure(error);
  return data;
}

export async function updateShop(shopId: string, fields: ShopUpdate): Promise<Shop> {
  const { data, error } = await db().from('shops').update(fields).eq('id', shopId).select('*').single();
  if (error) throw failure(error);
  return data;
}

// ------------------------------------------------------------------------------------ address → map

export type GeocodeResult =
  | { found: true; precision: 'address' | 'city'; latitude: number; longitude: number }
  | { found: false }
  /** The map service could not be reached; the old coordinates stay. */
  | { unavailable: true };

/** Edge Function `geocode`: looks up the saved address and stores the coordinates on the shop. */
export async function geocodeShop(): Promise<GeocodeResult> {
  const { data, error } = await db().functions.invoke('geocode', { method: 'POST' });
  if (!error) {
    const d = data as { found?: boolean; precision?: 'address' | 'city'; latitude?: number; longitude?: number };
    return d.found && d.precision && typeof d.latitude === 'number' && typeof d.longitude === 'number'
      ? { found: true, precision: d.precision, latitude: d.latitude, longitude: d.longitude }
      : { found: false };
  }
  if (error instanceof FunctionsFetchError) throw new RpcError('network');
  if (error instanceof FunctionsHttpError && (error.context as Response).status === 503) return { unavailable: true };
  if (error instanceof FunctionsHttpError && (error.context as Response).status === 401) throw failure({ code: 'PGRST301' });
  throw new RpcError('unknown');
}

// ------------------------------------------------------------------------------------ logo

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Uploads a logo into the shop's folder and points the shop at it; the previous file is removed. */
export async function uploadLogo(shop: Shop, file: File): Promise<Shop> {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${shop.id}/logo-${Date.now()}.${ext}`;
  const bucket = db().storage.from('logos');
  const { error } = await bucket.upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
  if (error) throw failure(error);
  const url = bucket.getPublicUrl(path).data.publicUrl;
  const saved = await updateShop(shop.id, { logo_url: url });
  await removeLogoFile(shop.logo_url);
  return saved;
}

export async function removeLogo(shop: Shop): Promise<Shop> {
  const saved = await updateShop(shop.id, { logo_url: null });
  await removeLogoFile(shop.logo_url);
  return saved;
}

/** Best effort: an orphaned file costs nothing visible. */
async function removeLogoFile(url: string | null) {
  const path = url?.split('/storage/v1/object/public/logos/')[1];
  if (!path) return;
  try {
    await db().storage.from('logos').remove([decodeURIComponent(path)]);
  } catch {
    // ignored
  }
}

// ------------------------------------------------------------------------------------ hours and closures

export interface DayHours {
  weekday: number; // 0 = Sunday
  is_closed: boolean;
  open_time: string | null; // HH:MM
  close_time: string | null;
}

export async function fetchHours(shopId: string): Promise<DayHours[]> {
  const { data, error } = await db()
    .from('shop_hours')
    .select('weekday, is_closed, open_time, close_time')
    .eq('shop_id', shopId)
    .order('weekday');
  if (error) throw failure(error);
  return data.map((d) => ({ ...d, open_time: d.open_time?.slice(0, 5) ?? null, close_time: d.close_time?.slice(0, 5) ?? null }));
}

/** The whole week in one transaction (`save_shop_hours`). */
export async function saveHours(hours: DayHours[], requestId: string): Promise<DayHours[]> {
  const payload = hours.map((h) =>
    h.is_closed ? { weekday: h.weekday, is_closed: true } : { weekday: h.weekday, is_closed: false, open_time: h.open_time, close_time: h.close_time },
  );
  return (await call('save_shop_hours', { p_hours: payload, p_request_id: requestId })) as unknown as DayHours[];
}

/** Closures that have not ended yet, soonest first. */
export async function fetchClosures(shopId: string, today: string): Promise<ShopClosure[]> {
  const { data, error } = await db()
    .from('shop_closures')
    .select('*')
    .eq('shop_id', shopId)
    .gte('end_date', today)
    .order('start_date');
  if (error) throw failure(error);
  return data;
}

export interface ClosureInput {
  start_date: string;
  end_date: string;
  label: string | null;
}

export async function addClosure(shopId: string, input: ClosureInput): Promise<ShopClosure> {
  const { data, error } = await db().from('shop_closures').insert({ shop_id: shopId, ...input }).select('*').single();
  if (error) throw failure(error);
  return data;
}

export async function updateClosure(id: string, input: ClosureInput): Promise<ShopClosure> {
  const { data, error } = await db().from('shop_closures').update(input).eq('id', id).select('*').single();
  if (error) throw failure(error);
  return data;
}

export async function deleteClosure(id: string): Promise<void> {
  const { error } = await db().from('shop_closures').delete().eq('id', id);
  if (error) throw failure(error);
}

// ------------------------------------------------------------------------------------ services

export interface CatalogCategory {
  key: string;
  name_ro: string;
  name_en: string;
  services: { id: string; name_ro: string; name_en: string }[];
}

/** Enabled catalog services, grouped by category in catalog order. */
export async function fetchCatalog(): Promise<CatalogCategory[]> {
  const [cats, svcs] = await Promise.all([
    db().from('service_categories').select('key, name_ro, name_en, position').eq('enabled', true).order('position'),
    db().from('services').select('id, category_key, name_ro, name_en, position').eq('enabled', true).order('position'),
  ]);
  if (cats.error) throw failure(cats.error);
  if (svcs.error) throw failure(svcs.error);
  return cats.data
    .map((c) => ({
      key: c.key,
      name_ro: c.name_ro,
      name_en: c.name_en,
      services: svcs.data
        .filter((s) => s.category_key === c.key)
        .map((s) => ({ id: s.id, name_ro: s.name_ro, name_en: s.name_en })),
    }))
    .filter((c) => c.services.length > 0);
}

export async function fetchShopServices(shopId: string): Promise<string[]> {
  const { data, error } = await db().from('shop_services').select('service_id').eq('shop_id', shopId);
  if (error) throw failure(error);
  return data.map((d) => d.service_id);
}

/** Replaces the offered services with exactly this set (`set_shop_services`). */
export async function saveShopServices(ids: string[], requestId: string): Promise<string[]> {
  return (await call('set_shop_services', { p_service_ids: ids, p_request_id: requestId })) as string[];
}

// ------------------------------------------------------------------------------------ billing (owner only)

export async function fetchBilling(shopId: string): Promise<ShopBilling | null> {
  const { data, error } = await db().from('shop_billing').select('*').eq('shop_id', shopId).maybeSingle();
  if (error) throw failure(error);
  return data;
}

export async function updateBilling(shopId: string, fields: BillingUpdate): Promise<ShopBilling> {
  const { data, error } = await db().from('shop_billing').update(fields).eq('shop_id', shopId).select('*').single();
  if (error) throw failure(error);
  return data;
}

// ------------------------------------------------------------------------------------ staff

export interface StaffMember {
  id: string;
  role: 'owner' | 'staff';
  name: string | null;
  email: string | null;
  invited_at: string;
  accepted_at: string | null;
  expired: boolean;
  is_me: boolean;
}

export async function listStaff(): Promise<StaffMember[]> {
  return (await call('list_shop_staff', {} as never)) as unknown as StaffMember[];
}

/** A random 256-bit token, hex. The database keeps only its SHA-256. */
export function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function inviteLink(token: string): string {
  return `${window.location.origin}/invitatie/${token}`;
}

export async function inviteStaff(email: string, token: string, requestId: string): Promise<void> {
  await call('invite_staff', { p_email: email, p_token: token, p_request_id: requestId });
}

export async function removeStaff(id: string): Promise<void> {
  const { error } = await db().from('shop_staff').delete().eq('id', id);
  if (error) throw failure(error);
}

export interface StaffInvite {
  shop_name: string;
  city: string;
  email: string;
}

/** The invitation behind a link, or null when it is unknown, used or expired. Works signed out. */
export async function getStaffInvite(token: string): Promise<StaffInvite | null> {
  return (await call('get_staff_invite', { p_token: token })) as unknown as StaffInvite | null;
}

// ------------------------------------------------------------------------------------ Panou: checklist and visibility

export type SetupStep = 'services' | 'hours' | 'capacity' | 'phone';
export const SETUP_STEPS: readonly SetupStep[] = ['services', 'hours', 'capacity', 'phone'];

export type HiddenReason =
  | 'account_suspended'
  | 'shop_suspended'
  | 'shop_inactive'
  | 'subscription_inactive'
  | 'email_unverified'
  | 'phone_unverified'
  | 'no_services'
  | 'no_open_days';

export interface ShopSetup {
  shop_id: string;
  shop_name: string;
  is_owner: boolean;
  daily_capacity: number;
  steps: Record<SetupStep, boolean>;
  owner_phone: string | null;
  setup_completed: boolean;
  public: boolean;
  reasons: HiddenReason[];
  subscription_status: string | null;
  trial_ends_at: string | null;
  /** Owner only. */
  billing?: { complete: boolean; reminder: boolean };
}

export async function getShopSetup(): Promise<ShopSetup> {
  return (await call('get_shop_setup', {} as never)) as unknown as ShopSetup;
}

export async function dismissBillingReminder(shopId: string): Promise<void> {
  // The database stores its own time whatever is sent (trigger shops_stamp_times).
  await updateShop(shopId, { billing_reminder_dismissed_at: new Date().toISOString() });
}
