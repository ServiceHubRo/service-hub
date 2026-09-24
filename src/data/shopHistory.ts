import { call } from './rpc';
import type { CarSnapshot } from './bookings';
import type { Quote } from '../lib/clientBookings';
import type { HistoryStatus } from '../lib/history';

/**
 * The shop's repair history (FR §4.3, P16b; T10), in one read: `list_shop_history()` answers only
 * for the caller's own shop with every finished booking — done, quote refused, expired, canceled,
 * no-show — newest first, with the quote that belongs to how it ended.
 */

export type HistoryQuote = Omit<Quote, 'expires_at'>;

export interface ShopHistoryItem {
  id: string;
  ref: string;
  status: HistoryStatus;
  date: string; // YYYY-MM-DD, Europe/Bucharest
  slot: string; // HH:MM, Europe/Bucharest
  note: string | null;
  service_id: string;
  service_ro: string | null;
  service_en: string | null;
  service_icon: string | null;
  client_name: string | null;
  client_phone: string | null;
  /** False once the client deleted the account (no conversation to open). */
  has_client: boolean;
  car_snapshot: CarSnapshot;
  odometer: number | null;
  work: string | null;
  cost: number | null;
  done_at: string | null;
  cancelled_by: 'client' | 'shop' | 'admin' | null;
  cancel_reason: string | null;
  /** When it ended: finished, canceled, or the last status change. */
  ended_at: string;
  /** The accepted version of a finished job, the refused or the expired one; else null. */
  quote: HistoryQuote | null;
}

export interface ShopHistoryData {
  shop: { id: string; name: string };
  bookings: ShopHistoryItem[];
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : toNumber(value);
}

/** Amounts arrive as JSON numbers from numeric columns; normalized once here. */
function normalize(data: ShopHistoryData): ShopHistoryData {
  return {
    ...data,
    bookings: data.bookings.map((b) => ({
      ...b,
      cost: toNumberOrNull(b.cost),
      quote: b.quote && {
        ...b.quote,
        inspection_fee: toNumber(b.quote.inspection_fee),
        total_sent: toNumber(b.quote.total_sent),
        total_approved: toNumberOrNull(b.quote.total_approved),
        items: b.quote.items.map((i) => ({ ...i, price: toNumber(i.price) })),
      },
    })),
  };
}

export async function fetchShopHistory(): Promise<ShopHistoryData> {
  const data = await call('list_shop_history', {} as never);
  return normalize(data as unknown as ShopHistoryData);
}
