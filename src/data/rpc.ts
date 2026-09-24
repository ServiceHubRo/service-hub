import type { Database, Json } from './database.types';
import { reportSessionLost } from './sessionEvents';
import { supabase } from './supabase';
import { formatKm } from '../i18n/format';
import type { MessageKey } from '../i18n/ro';
import { plural, translate, type Lang } from '../i18n/translate';

/**
 * Typed calls to the database functions (ARCHITECTURE §3). Every state change goes through one of
 * these; the browser never writes bookings, quotes, reviews or messages directly.
 *
 * Mutating calls take the `requestId` that ActionButton hands to `onAction`: a retry with the
 * same id returns the first result instead of acting twice (CLAUDE.md §6.7).
 *
 * Failures are thrown as `RpcError` with a stable `code`; `rpcErrorMessage()` turns it into
 * translated text. A raw database error is never shown to a user.
 */

type Tables = Database['public']['Tables'];
export type Booking = Tables['bookings']['Row'];
export type Message = Tables['messages']['Row'];
export type Review = Tables['reviews']['Row'];

// ------------------------------------------------------------------------------------ errors

/** Every code the database functions raise. `tests/unit/rpc.test.ts` checks this list against the migrations. */
export const RPC_ERROR_CODES = [
  'account_has_active_bookings',
  'account_suspended',
  'already_reported',
  'booking_not_found',
  'cancel_deadline_passed',
  'car_invalid',
  'car_not_found',
  'car_plate_invalid',
  'car_required',
  'car_vin_invalid',
  'car_year_invalid',
  'cost_invalid',
  'day_full',
  'email_invalid',
  'email_not_verified',
  'hours_close_before_open',
  'hours_invalid',
  'invalid_slot',
  'invite_invalid',
  'limit_active_shop',
  'limit_active_total',
  'limit_daily',
  'limit_messages',
  'limit_quote_versions',
  'limit_staff',
  'message_empty',
  'message_too_long',
  'no_booking_together',
  'not_allowed',
  'not_signed_in',
  'note_too_long',
  'odometer_invalid',
  'odometer_jump',
  'odometer_lower',
  'odometer_required',
  'past_slot',
  'quote_changed',
  'quote_expired',
  'quote_item_invalid',
  'quote_items_required',
  'quote_too_many_items',
  'quote_total_zero',
  'rating_invalid',
  'reason_required',
  'reason_too_long',
  'reply_too_long',
  'report_reason_invalid',
  'request_id_required',
  'request_id_reused',
  'review_exists',
  'review_not_found',
  'review_too_long',
  'review_window_closed',
  'service_unavailable',
  'shop_closed',
  'shop_has_active_bookings',
  'shop_not_found',
  'shop_unavailable',
  'slot_full',
  'staff_exists',
  'thread_not_found',
  'too_early',
  'too_far',
  'too_soon',
  'work_too_long',
  'wrong_status',
] as const;

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number] | 'network' | 'unknown';

/** Parameters some codes carry, e.g. `odometer_lower` → `{ previous: 105400 }`. */
export type RpcErrorParams = Record<string, string | number | boolean | null>;

export class RpcError extends Error {
  readonly code: RpcErrorCode;
  readonly params: RpcErrorParams;

  constructor(code: RpcErrorCode, params: RpcErrorParams = {}) {
    super(code);
    this.name = 'RpcError';
    this.code = code;
    this.params = params;
  }
}

/**
 * Codes after which the booking screens reload the day list and send the client back to picking a
 * day or time (the calendar they looked at is out of date).
 */
export const RELOAD_AVAILABILITY_CODES: ReadonlySet<RpcErrorCode> = new Set([
  'past_slot',
  'day_full',
  'slot_full',
  'too_soon',
  'too_far',
  'shop_closed',
  'invalid_slot',
]);

const knownCodes: ReadonlySet<string> = new Set(RPC_ERROR_CODES);

function parseParams(details: unknown): RpcErrorParams {
  if (typeof details !== 'string' || details === '') return {};
  try {
    const parsed: unknown = JSON.parse(details);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as RpcErrorParams) : {};
  } catch {
    return {};
  }
}

/** Turns whatever supabase-js or fetch threw into an RpcError. */
export function toRpcError(error: unknown): RpcError {
  if (error instanceof RpcError) return error;
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; details?: unknown; name?: unknown; code?: unknown };
    if (typeof e.message === 'string' && knownCodes.has(e.message)) {
      return new RpcError(e.message as RpcErrorCode, parseParams(e.details));
    }
    // PostgREST refusing the access token (expired or revoked session).
    if (e.code === 'PGRST301' || e.code === 'PGRST303' || (typeof e.message === 'string' && /JWT expired/i.test(e.message))) {
      return new RpcError('not_signed_in');
    }
    // fetch failures: "TypeError: Failed to fetch" (Chrome), "Load failed" (Safari), "NetworkError…" (Firefox).
    if (e.name === 'TypeError' || (typeof e.message === 'string' && /fetch|network|load failed/i.test(e.message))) {
      return new RpcError('network');
    }
  }
  return new RpcError('unknown');
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Translated, user-facing text for any error thrown by the calls below. */
export function rpcErrorMessage(lang: Lang, error: unknown): string {
  const { code, params } = toRpcError(error);
  const p = params;
  switch (code) {
    case 'network':
      return translate(lang, 'action.error');
    case 'unknown':
    case 'request_id_required':
    case 'request_id_reused':
      return translate(lang, 'rpcError.unknown');
    case 'odometer_lower':
      return translate(lang, 'rpcError.odometer_lower', { previous: formatKm(lang, num(p.previous) ?? 0) });
    case 'odometer_jump':
      return translate(lang, 'rpcError.odometer_jump', { diff: formatKm(lang, num(p.diff) ?? 0) });
    case 'too_soon':
    case 'cancel_deadline_passed':
      return translate(lang, `rpcError.${code}`, { hours: plural(lang, 'unit.hours', num(p.hours) ?? 0) });
    case 'too_far':
    case 'review_window_closed':
      return translate(lang, `rpcError.${code}`, { days: plural(lang, 'unit.days', num(p.days) ?? 0) });
    case 'hours_close_before_open':
      return translate(lang, 'rpcError.hours_close_before_open', {
        day: translate(lang, `weekday.${num(p.weekday) ?? 1}` as MessageKey),
      });
    case 'quote_item_invalid':
      return num(p.position) === null
        ? translate(lang, 'rpcError.quote_item_invalid')
        : translate(lang, 'rpcError.quote_item_invalid_at', { position: num(p.position) ?? 0 });
    default: {
      const values: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(p)) if (typeof v === 'string' || typeof v === 'number') values[k] = v;
      return translate(lang, `rpcError.${code}` as MessageKey, values);
    }
  }
}

/**
 * Whether "Încearcă din nou" can help: only when the answer never arrived or the failure was not a
 * business rule (a full day or a limit stays the same on a second try).
 */
export function canRetryRpc(error: unknown): boolean {
  const code = toRpcError(error).code;
  return code === 'network' || code === 'unknown';
}

// ------------------------------------------------------------------------------------ plumbing

type Fns = Database['public']['Functions'];

/** Converts a failure and, when it means the session is gone, tells SessionProvider. */
export function failure(error: unknown): RpcError {
  const rpcError = toRpcError(error);
  if (rpcError.code === 'not_signed_in') reportSessionLost();
  return rpcError;
}

export async function call<F extends keyof Fns>(fn: F, args: Fns[F]['Args']): Promise<Fns[F]['Returns']> {
  if (!supabase) throw new RpcError('network');
  let result;
  try {
    result = await supabase.rpc(fn, args as never);
  } catch (e) {
    throw failure(e);
  }
  if (result.error) throw failure(result.error);
  return result.data as Fns[F]['Returns'];
}

// ------------------------------------------------------------------------------------ availability and search

export type AvailabilityDayReason = 'closed' | 'closure' | 'too_far' | 'full' | 'no_slots';
export type AvailabilitySlotReason = 'past' | 'too_soon' | 'full' | 'too_far';

export interface AvailabilityDay {
  date: string; // YYYY-MM-DD, Europe/Bucharest
  bookable: boolean;
  places_left: number;
  reason: AvailabilityDayReason | null;
}

export interface AvailabilitySlot {
  time: string; // HH:MM, Europe/Bucharest
  taken: number;
  capacity: number;
  available: boolean;
  reason: AvailabilitySlotReason | null;
}

export interface Availability {
  days: AvailabilityDay[];
  slots: AvailabilitySlot[];
}

/**
 * Days from `from` (default today) with places left; with `slotsFor`, that day's slots too. A shop
 * moving one of its bookings passes `excludeBooking`, so the place it holds now counts as free.
 */
export async function getAvailability(
  shopId: string,
  options: { from?: string; days?: number; slotsFor?: string; excludeBooking?: string } = {},
): Promise<Availability> {
  const data = await call('get_availability', {
    p_shop_id: shopId,
    p_from: options.from,
    p_days: options.days,
    p_slots_for: options.slotsFor,
    p_exclude_booking: options.excludeBooking,
  });
  return data as unknown as Availability;
}

export type SearchSort = 'rating' | 'distance';

export interface ShopSearchResult {
  shop_id: string;
  name: string;
  city: string;
  street: string | null;
  logo_url: string | null;
  latitude: number | null;
  longitude: number | null;
  review_count: number;
  average: number | null;
  weighted_score: number;
  service_count: number;
  /** Set when the shop matched by a service or the category filter ("Oferă: …"). */
  matched_service_id: string | null;
  matched_service_ro: string | null;
  matched_service_en: string | null;
  distance_km: number | null;
  is_favorite: boolean;
}

/** Public shops in rating order (ARCHITECTURE §8). The location is sent for this query only, never stored. */
export async function searchShops(params: {
  q?: string;
  category?: string;
  city?: string;
  lat?: number;
  lng?: number;
  sort?: SearchSort;
} = {}): Promise<ShopSearchResult[]> {
  const data = await call('search_shops', {
    p_q: params.q,
    p_category: params.category,
    p_city: params.city,
    p_lat: params.lat,
    p_lng: params.lng,
    p_sort: params.sort,
  });
  return data as unknown as ShopSearchResult[];
}

// ------------------------------------------------------------------------------------ bookings

/** A car typed in the booking form instead of picked from the garage. */
export interface CarInput {
  make: string;
  model: string;
  year?: number | null;
  plate?: string | null;
  vin?: string | null;
}

export interface CreateBookingInput {
  shopId: string;
  serviceId: string;
  date: string; // YYYY-MM-DD
  slot: string; // HH:MM
  car: { carId: string } | { car: CarInput; saveCar: boolean };
  note?: string;
}

export function createBooking(input: CreateBookingInput, requestId: string): Promise<Booking> {
  const car = input.car;
  return call('create_booking', {
    p_shop_id: input.shopId,
    p_service_id: input.serviceId,
    p_date: input.date,
    p_slot: input.slot,
    p_request_id: requestId,
    ...('carId' in car
      ? { p_car_id: car.carId }
      : { p_car: car.car as unknown as Json, p_save_car: car.saveCar }),
    p_note: input.note,
  });
}

export function confirmBooking(bookingId: string, requestId: string): Promise<Booking> {
  return call('confirm_booking', { p_booking_id: bookingId, p_request_id: requestId });
}

export function declineBooking(bookingId: string, reason: string | undefined, requestId: string): Promise<Booking> {
  return call('decline_booking', { p_booking_id: bookingId, p_reason: reason, p_request_id: requestId });
}

export function rescheduleBooking(bookingId: string, date: string, slot: string, requestId: string): Promise<Booking> {
  return call('reschedule_booking', { p_booking_id: bookingId, p_date: date, p_slot: slot, p_request_id: requestId });
}

/** Client cancels (pending: always; confirmed: before the shop's deadline). */
export function cancelBooking(bookingId: string, requestId: string): Promise<Booking> {
  return call('cancel_booking', { p_booking_id: bookingId, p_request_id: requestId });
}

/** Shop cancels a confirmed booking; the reason is required and sent to the client. */
export function shopCancelBooking(bookingId: string, reason: string, requestId: string): Promise<Booking> {
  return call('shop_cancel_booking', { p_booking_id: bookingId, p_reason: reason, p_request_id: requestId });
}

export function markNoShow(bookingId: string, requestId: string): Promise<Booking> {
  return call('mark_no_show', { p_booking_id: bookingId, p_request_id: requestId });
}

export function startInspection(bookingId: string, requestId: string): Promise<Booking> {
  return call('start_inspection', { p_booking_id: bookingId, p_request_id: requestId });
}

export function adminForceCancel(bookingId: string, reason: string, requestId: string): Promise<Booking> {
  return call('admin_force_cancel', { p_booking_id: bookingId, p_reason: reason, p_request_id: requestId });
}

// ------------------------------------------------------------------------------------ quotes and work

export interface QuoteLineInput {
  name: string;
  /** Lei, at most 2 decimals. */
  price: number;
}

export function sendQuote(bookingId: string, items: QuoteLineInput[], note: string | undefined, requestId: string): Promise<Booking> {
  return call('send_quote', {
    p_booking_id: bookingId,
    p_items: items as unknown as Json,
    p_note: note,
    p_request_id: requestId,
  });
}

/** "Edit quote": the waiting version is superseded by a new one; the expiry clock restarts. */
export function replaceQuote(bookingId: string, items: QuoteLineInput[], note: string | undefined, requestId: string): Promise<Booking> {
  return call('replace_quote', {
    p_booking_id: bookingId,
    p_items: items as unknown as Json,
    p_note: note,
    p_request_id: requestId,
  });
}

export function withdrawQuote(bookingId: string, requestId: string): Promise<Booking> {
  return call('withdraw_quote', { p_booking_id: bookingId, p_request_id: requestId });
}

/**
 * The client's answer to the quote version `quoteId`. All lines → accepted; some → partially
 * accepted; none → refused (the inspection fee becomes the cost).
 */
export function decideQuote(bookingId: string, quoteId: string, approvedItemIds: string[], requestId: string): Promise<Booking> {
  return call('decide_quote', {
    p_booking_id: bookingId,
    p_quote_id: quoteId,
    p_approved_item_ids: approvedItemIds,
    p_request_id: requestId,
  });
}

export function startWork(bookingId: string, requestId: string): Promise<Booking> {
  return call('start_work', { p_booking_id: bookingId, p_request_id: requestId });
}

export interface CompleteJobInput {
  bookingId: string;
  odometer: number;
  /** Defaults to the approved quote lines. */
  work?: string;
  /** Defaults to the approved total. */
  cost?: number;
  /** Set after the user confirmed an `odometer_jump`. */
  confirmJump?: boolean;
}

export function completeJob(input: CompleteJobInput, requestId: string): Promise<Booking> {
  return call('complete_job', {
    p_booking_id: input.bookingId,
    p_odometer: input.odometer,
    p_work: input.work,
    p_cost: input.cost,
    p_confirm_jump: input.confirmJump ?? false,
    p_request_id: requestId,
  });
}

/** Highest reading among done jobs of this booking's plate (own shop only); null for a first visit. */
export async function lastOdometerForBooking(bookingId: string): Promise<number | null> {
  const data = await call('last_odometer_for_booking', { p_booking_id: bookingId });
  return (data as number | null) ?? null;
}

/** No-shows of a client in the last `days` days (default 90). */
export function clientNoShowCount(clientId: string, days?: number): Promise<number> {
  return call('client_no_show_count', { p_client_id: clientId, p_days: days });
}

// ------------------------------------------------------------------------------------ messages, reviews, favorites

export function sendMessage(threadId: string, body: string, requestId: string): Promise<Message> {
  return call('send_message', { p_thread_id: threadId, p_body: body, p_request_id: requestId });
}

/** Marks the caller's side of the thread as read; returns the marker time. Safe to repeat. */
export function markThreadRead(threadId: string): Promise<string> {
  return call('mark_thread_read', { p_thread_id: threadId });
}

export function submitReview(bookingId: string, rating: number, text: string | undefined, requestId: string): Promise<Review> {
  return call('submit_review', { p_booking_id: bookingId, p_rating: rating, p_text: text, p_request_id: requestId });
}

/** Public reply; an empty text removes it. */
export function replyReview(reviewId: string, reply: string, requestId: string): Promise<Review> {
  return call('reply_review', { p_review_id: reviewId, p_reply: reply, p_request_id: requestId });
}

export type ReportReason = 'fake' | 'abusive' | 'wrong_shop' | 'personal_data';

export function reportReview(reviewId: string, reason: ReportReason, requestId: string): Promise<Review> {
  return call('report_review', { p_review_id: reviewId, p_reason: reason, p_request_id: requestId });
}

/** Adds or removes the shop from the client's favorites; returns the new state. */
export function toggleFavorite(shopId: string, requestId: string): Promise<boolean> {
  return call('toggle_favorite', { p_shop_id: shopId, p_request_id: requestId });
}
