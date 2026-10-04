import { call, failure, fetchNewClientOffers, fetchSearchExtras, RpcError, type FreePlace, type ResponseBadge } from './rpc';
import { supabase } from './supabase';
import type { DayHours } from '../lib/hours';

/**
 * Client search and the shop page (FR §3.1, §3.2; T06). Search itself is `searchShops()` in rpc.ts;
 * the client's location never leaves the browser (distances are computed in src/lib/geo.ts).
 */

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

export interface SearchCategory {
  key: string;
  name_ro: string;
  name_en: string;
}

/** Catalog categories for the chips, in catalog order. */
export async function fetchCategories(): Promise<SearchCategory[]> {
  const { data, error } = await db()
    .from('service_categories')
    .select('key, name_ro, name_en')
    .eq('enabled', true)
    .order('position');
  if (error) throw failure(error);
  return data;
}

export interface SearchCity {
  city: string;
  shop_count: number;
}

/** Cities that have public shops, most shops first — never a hard-coded list (P16). */
export async function fetchCities(): Promise<SearchCity[]> {
  return call('search_cities', {} as never);
}

export interface ShopPageShop {
  id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  street: string | null;
  city: string;
  county: string | null;
  phone: string | null;
  phone2: string | null;
  website: string | null;
  facebook: string | null;
  year_established: number | null;
  latitude: number | null;
  longitude: number | null;
  daily_capacity: number;
  cars_per_slot: number;
  min_notice_hours: number;
  max_advance_days: number;
  cancel_deadline_hours: number;
  inspection_fee: number;
  /** Free places are confirmed at once (T28a). */
  auto_confirm: boolean;
  slot_minutes: number;
  /** Facilities ticked by the shop (T28b). */
  amenities: string[];
}

export interface ShopPageService {
  id: string;
  icon: string | null;
  name_ro: string;
  name_en: string;
  category_key: string;
  category_ro: string;
  category_en: string;
}

export interface ShopPageReview {
  id: string;
  display_name: string;
  rating: number;
  text: string | null;
  created_at: string;
  reply: string | null;
  reply_at: string | null;
}

export interface ShopClosurePublic {
  start_date: string;
  end_date: string;
  label: string | null;
}

export interface ShopPage {
  shop: ShopPageShop;
  /** False when the client may still read the shop (an old booking) but it takes no bookings now. */
  bookable: boolean;
  is_favorite: boolean;
  rating: { review_count: number; average: number | null };
  hours: DayHours[];
  closures: ShopClosurePublic[];
  services: ShopPageService[];
  reviews: ShopPageReview[];
  /** The discount on labor the caller would get on a first booking here (T23); null without one. */
  offer: number | null;
  /** The first free place on the day asked, else within the next 14 days (T28a); null when none. */
  free: FreePlace | null;
  /** How quickly the shop usually answers (T28b). */
  response: ResponseBadge;
  /** Photos of the workshop, in the shop's order (T28b). */
  photos: { id: string; url: string }[];
}

/** Everything the shop page shows, public columns only (get_shop_page); `day` for its free place. */
export async function fetchShopPage(shopId: string, day?: string | null): Promise<ShopPage> {
  const [read, offers, extras] = await Promise.all([
    call('get_shop_page', { p_shop_id: shopId }),
    fetchNewClientOffers([shopId]).catch(() => new Map<string, number>()),
    fetchSearchExtras([shopId], day ?? undefined).catch(() => null),
  ]);
  const page = read as unknown as ShopPage;
  page.offer = offers.get(shopId) ?? null;
  page.free = extras?.get(shopId)?.free ?? null;
  // numeric columns arrive as numbers from jsonb; keep them numbers even if a driver sends text.
  page.shop.inspection_fee = Number(page.shop.inspection_fee);
  page.rating.average = page.rating.average === null ? null : Number(page.rating.average);
  return page;
}

/** How many shops the client saved, including any that are hidden from search right now. */
export async function countFavorites(): Promise<number> {
  const { count, error } = await db().from('favorites').select('shop_id', { count: 'exact', head: true });
  if (error) throw failure(error);
  return count ?? 0;
}

/** "Nu acum" on the location banner: it does not come back on its own (P16d). */
export async function dismissLocationPrompt(userId: string): Promise<void> {
  const { error } = await db()
    .from('profiles')
    .update({ location_prompt_dismissed_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw failure(error);
}
