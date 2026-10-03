import { call } from './rpc';
import type { CarSnapshot } from './bookings';
import type { BookingStatus } from '../lib/status';
import type { ExtraService } from '../lib/bookingServices';

/**
 * The shop's active bookings for Panou and Programări (FR §4.1, §4.2; T08), in one read:
 * `list_shop_bookings()` answers only for the caller's own shop, with the service names, the
 * client's account id and no-show count (clients' profiles stay unreadable) and the current quote.
 */

export type QuoteStatus = 'sent' | 'accepted' | 'partially_accepted';

export interface ShopQuoteItem {
  id: string;
  position: number;
  name: string;
  price: number;
  /** Null until the client decides. */
  approved: boolean | null;
}

export interface ShopQuote {
  id: string;
  version: number;
  status: QuoteStatus;
  note: string | null;
  inspection_fee: number;
  total_sent: number;
  total_approved: number | null;
  sent_at: string;
  expires_at: string | null;
  items: ShopQuoteItem[];
}

export interface ShopBooking {
  id: string;
  ref: string;
  status: BookingStatus;
  date: string; // YYYY-MM-DD, Europe/Bucharest
  slot: string; // HH:MM, Europe/Bucharest
  note: string | null;
  service_id: string;
  service_ro: string | null;
  service_en: string | null;
  service_icon: string | null;
  /** The other services of the same booking (T21), in the order they were ticked. */
  extra_services?: ExtraService[];
  client_name: string | null;
  client_phone: string | null;
  /** Account id (`C-00012`); null when the client deleted the account. */
  client_account: string | null;
  /** No-shows in the last 90 days, at any shop (§6). */
  client_no_shows: number;
  /** The new-client discount on labor this booking was promised (T23). */
  offer_percent?: number | null;
  /** The loyalty discount promised (T28c) and the client's level then. */
  loyalty_percent?: number | null;
  loyalty_level?: number | null;
  /** The client lets the shop see the car's jobs at other shops (T27). */
  share_history?: boolean;
  car_snapshot: CarSnapshot;
  created_at: string;
  confirmed_at: string | null;
  inspection_started_at: string | null;
  started_at: string | null;
  /** From quote_sent on: the waiting or the accepted version. */
  quote: ShopQuote | null;
}

export interface ShopBookingsData {
  shop: { id: string; name: string; city: string; daily_capacity: number; inspection_fee: number };
  quote_expiry_days: number;
  bookings: ShopBooking[];
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Amounts arrive as JSON numbers from numeric columns; normalized once here. */
function normalize(data: ShopBookingsData): ShopBookingsData {
  return {
    ...data,
    shop: { ...data.shop, inspection_fee: toNumber(data.shop.inspection_fee) },
    bookings: data.bookings.map((b) => ({
      ...b,
      quote: b.quote && {
        ...b.quote,
        inspection_fee: toNumber(b.quote.inspection_fee),
        total_sent: toNumber(b.quote.total_sent),
        total_approved: b.quote.total_approved === null ? null : toNumber(b.quote.total_approved),
        items: b.quote.items.map((i) => ({ ...i, price: toNumber(i.price) })),
      },
    })),
  };
}

export async function fetchShopBookings(): Promise<ShopBookingsData> {
  const data = await call('list_shop_bookings', {} as never);
  return normalize(data as unknown as ShopBookingsData);
}
