import type { ReportReason } from './rpc';
import { call, failure, RpcError } from './rpc';
import { supabase } from './supabase';

/**
 * The shop's reviews (FR §4.5, P10; T11), read straight from the table: RLS lets a shop's members
 * read all of their shop's reviews, removed ones included. The booking's reference and service
 * come along. Replies and reports go through `reply_review` / `report_review` (src/data/rpc.ts).
 */

export interface ShopReview {
  id: string;
  booking_id: string;
  shop_id: string;
  /** "Andrei M."; empty when the client deleted the account. */
  client_display_name: string;
  rating: number;
  text: string | null;
  reply: string | null;
  reply_at: string | null;
  report_reason: ReportReason | null;
  reported_at: string | null;
  report_status: 'pending' | 'kept' | 'removed' | null;
  removed_at: string | null;
  created_at: string;
  booking: { ref: string; service: { name_ro: string; name_en: string } | null } | null;
}

export interface ShopReviewsData {
  shopId: string;
  reviews: ShopReview[];
}

const COLUMNS = [
  'id, booking_id, shop_id, client_display_name, rating, text, reply, reply_at',
  'report_reason, reported_at, report_status, removed_at, created_at',
  'booking:bookings(ref, service:services(name_ro, name_en))',
].join(', ');

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

/** The caller's shop's reviews, newest first. */
export async function fetchShopReviews(): Promise<ShopReviewsData> {
  const shopId = (await call('my_shop_id', {} as never)) as string | null;
  if (!shopId) throw new RpcError('not_allowed');
  const { data, error } = await db()
    .from('reviews')
    .select(COLUMNS)
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false });
  if (error) throw failure(error);
  return { shopId, reviews: data as unknown as ShopReview[] };
}

/** Average and count of the reviews that count (removed ones do not, as in `shop_ratings`). */
export function reviewSummary(reviews: readonly Pick<ShopReview, 'rating' | 'removed_at'>[]): { average: number | null; count: number } {
  const counted = reviews.filter((r) => r.removed_at === null);
  if (counted.length === 0) return { average: null, count: 0 };
  return { average: counted.reduce((sum, r) => sum + r.rating, 0) / counted.length, count: counted.length };
}
