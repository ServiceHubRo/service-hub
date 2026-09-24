import { failure, RpcError } from './rpc';
import { supabase } from './supabase';
import { currentQuote, type Quote } from '../lib/clientBookings';
import { isActiveStatus, type BookingStatus } from '../lib/status';

/**
 * The client's own bookings (FR §3.5, P10b; T07 basic cards, T09 quotes, cancelling, reviews).
 * Read straight from the tables: RLS shows a client only their own bookings, the quotes and
 * review of those bookings, and the shop's public columns; the shop and service names come along
 * in the same request.
 */

export interface CarSnapshot {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  plate?: string | null;
}

export interface ClientBooking {
  id: string;
  ref: string;
  status: BookingStatus;
  date: string; // YYYY-MM-DD, Europe/Bucharest
  slot: string; // HH:MM:SS, Europe/Bucharest
  note: string | null;
  car_id: string | null;
  car_snapshot: CarSnapshot;
  created_at: string;
  shop_id: string;
  service_id: string;
  inspection_started_at: string | null;
  started_at: string | null;
  done_at: string | null;
  odometer: number | null;
  work: string | null;
  cost: number | null;
  cancelled_by: 'client' | 'shop' | 'admin' | null;
  cancel_reason: string | null;
  decline_reason: string | null;
  shop: { name: string; city: string; phone: string | null; cancel_deadline_hours: number } | null;
  service: { name_ro: string; name_en: string; icon: string | null } | null;
  /** Every version the shop sent, with its lines (the card picks one with `currentQuote`). */
  quotes: Quote[];
  /** The client's review of this booking, once sent. */
  review: { id: string; rating: number } | null;
}

export interface ClientBookingsData {
  bookings: ClientBooking[];
  /** How long after completion a review can be left (platform setting, default 60). */
  reviewWindowDays: number;
}

const COLUMNS = [
  'id, ref, status, date, slot, note, car_id, car_snapshot, created_at, shop_id, service_id',
  'inspection_started_at, started_at, done_at, odometer, work, cost, cancelled_by, cancel_reason, decline_reason',
  'shop:shops(name, city, phone, cancel_deadline_hours)',
  'service:services(name_ro, name_en, icon)',
  'quotes(id, version, status, note, inspection_fee, total_sent, total_approved, sent_at, expires_at, decided_at, items:quote_items(id, position, name, price, approved))',
  'review:reviews(id, rating)',
].join(', ');

const REVIEW_WINDOW_DEFAULT = 60;

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : toNumber(value);
}

/** Amounts arrive as JSON numbers (or strings for big numerics); lines in their order. */
function normalize(row: ClientBooking): ClientBooking {
  // One-to-one embeds come back as an object; tolerate an array too.
  const review = Array.isArray(row.review) ? ((row.review[0] as ClientBooking['review']) ?? null) : row.review;
  return {
    ...row,
    cost: toNumberOrNull(row.cost),
    review,
    quotes: (row.quotes ?? []).map((q) => ({
      ...q,
      inspection_fee: toNumber(q.inspection_fee),
      total_sent: toNumber(q.total_sent),
      total_approved: toNumberOrNull(q.total_approved),
      items: [...(q.items ?? [])].map((i) => ({ ...i, price: toNumber(i.price) })).sort((a, b) => a.position - b.position),
    })),
  };
}

export async function fetchClientBookings(clientId: string): Promise<ClientBooking[]> {
  const { data, error } = await db()
    .from('bookings')
    .select(COLUMNS)
    .eq('client_id', clientId)
    .order('date', { ascending: false })
    .order('slot', { ascending: false });
  if (error) throw failure(error);
  return (data as unknown as ClientBooking[]).map(normalize);
}

async function fetchReviewWindowDays(): Promise<number> {
  const { data, error } = await db().from('platform_settings').select('limits').eq('id', 1).maybeSingle();
  if (error) throw failure(error);
  const days = Number((data?.limits as Record<string, unknown> | undefined)?.review_window_days);
  return Number.isFinite(days) && days > 0 ? days : REVIEW_WINDOW_DEFAULT;
}

export async function fetchClientBookingsData(clientId: string): Promise<ClientBookingsData> {
  const [bookings, reviewWindowDays] = await Promise.all([fetchClientBookings(clientId), fetchReviewWindowDays()]);
  return { bookings, reviewWindowDays };
}

/** The quote this booking's card shows (the waiting one, or the one that was decided). */
export function quoteOf(b: ClientBooking): Quote | null {
  return currentQuote(b.status, b.quotes);
}

/**
 * "Active first" (FR §3.5): what is still going on, soonest first; then what has ended, newest
 * first.
 */
export function splitBookings<T extends Pick<ClientBooking, 'status' | 'date' | 'slot'>>(
  bookings: readonly T[],
): { active: T[]; past: T[] } {
  const when = (b: T) => `${b.date} ${b.slot}`;
  const active = bookings.filter((b) => isActiveStatus(b.status)).sort((a, b) => when(a).localeCompare(when(b)));
  const past = bookings.filter((b) => !isActiveStatus(b.status)).sort((a, b) => when(b).localeCompare(when(a)));
  return { active, past };
}
