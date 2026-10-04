import type { Json } from './database.types';
import { call, type Booking } from './rpc';
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
  /** Who answered (T29): the client in the app, or the shop for a client without an account. */
  decided_by?: 'client' | 'shop' | null;
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
  /** Booked in the app, or added by the shop for a client who called or walked in (T29). */
  source?: BookingSource;
  /** The email the shop typed for such a client (optional). */
  client_email?: string | null;
  /** When the SMS with the link went out; null when the shop chose not to send it. */
  invite_sent_at?: string | null;
  /** The client has an account on this booking (always for app bookings). */
  claimed?: boolean;
  car_snapshot: CarSnapshot;
  created_at: string;
  confirmed_at: string | null;
  inspection_started_at: string | null;
  started_at: string | null;
  /** From quote_sent on: the waiting or the accepted version. */
  quote: ShopQuote | null;
}

export type BookingSource = 'app' | 'shop';

/** A booking the shop typed in itself and the client has no account (T29). */
export function isUnclaimedWalkIn(b: Pick<ShopBooking, 'source' | 'claimed'>): boolean {
  return b.source === 'shop' && b.claimed === false;
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

export interface WalkInInput {
  serviceId: string;
  date: string; // YYYY-MM-DD
  slot: string; // HH:MM
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  car: { make: string; model: string; plate: string; year?: number | null };
  note?: string;
  /** SMS (and email, when given) with the link to the booking. */
  sendInvite: boolean;
  /** The language of that message. */
  clientLang: 'ro' | 'en';
}

/** A booking for a client who called or walked in (T29): confirmed at once, takes its place in the day. */
export function shopCreateBooking(input: WalkInInput, requestId: string): Promise<Booking> {
  return call('shop_create_booking', {
    p_service_id: input.serviceId,
    p_date: input.date,
    p_slot: input.slot,
    p_client_name: input.clientName,
    p_client_phone: input.clientPhone,
    p_car: input.car as unknown as Json,
    p_request_id: requestId,
    p_client_email: input.clientEmail,
    p_note: input.note,
    p_send_invite: input.sendInvite,
    p_client_lang: input.clientLang,
  });
}

/**
 * The client's answer to the quote, given at the shop and recorded by it (T29) — only for a booking
 * the shop added whose client has no account. Same outcome as the client's own answer.
 */
export function shopDecideQuote(bookingId: string, quoteId: string, approvedItemIds: string[], requestId: string): Promise<Booking> {
  return call('shop_decide_quote', {
    p_booking_id: bookingId,
    p_quote_id: quoteId,
    p_approved_item_ids: approvedItemIds,
    p_request_id: requestId,
  });
}
