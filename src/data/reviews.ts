import type { ReportReason } from './rpc';
import { call } from './rpc';

/**
 * The shop's reviews (FR §4.5, P10; T11), removed ones included, each with its booking's reference
 * and service. Read through a database function since A12: the report's reason and state are not
 * readable from the table. Replies and reports go through `reply_review` / `report_review` (src/data/rpc.ts).
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

/** The caller's shop's reviews, newest first (`list_my_shop_reviews`, A12). */
export async function fetchShopReviews(): Promise<ShopReviewsData> {
  const data = (await call('list_my_shop_reviews', {} as never)) as unknown as { shop_id: string; reviews: ShopReview[] };
  return { shopId: data.shop_id, reviews: data.reviews };
}

/** Average and count of the reviews that count (removed ones do not, as in `shop_ratings`). */
export function reviewSummary(reviews: readonly Pick<ShopReview, 'rating' | 'removed_at'>[]): { average: number | null; count: number } {
  const counted = reviews.filter((r) => r.removed_at === null);
  if (counted.length === 0) return { average: null, count: 0 };
  return { average: counted.reduce((sum, r) => sum + r.rating, 0) / counted.length, count: counted.length };
}
