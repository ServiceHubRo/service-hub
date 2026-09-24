import { failure, RpcError } from './rpc';
import { supabase } from './supabase';
import { isActiveStatus, type BookingStatus } from '../lib/status';

/**
 * The client's own bookings (FR §3.5, P10b; T07 basic cards, T09 adds quotes and actions). Read
 * straight from the table: RLS shows a client only their own rows, and the shop and service
 * names come along in the same request.
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
  car_snapshot: CarSnapshot;
  created_at: string;
  shop_id: string;
  service_id: string;
  shop: { name: string; city: string } | null;
  service: { name_ro: string; name_en: string; icon: string | null } | null;
}

const COLUMNS =
  'id, ref, status, date, slot, note, car_snapshot, created_at, shop_id, service_id, shop:shops(name, city), service:services(name_ro, name_en, icon)';

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

export async function fetchClientBookings(clientId: string): Promise<ClientBooking[]> {
  const { data, error } = await db()
    .from('bookings')
    .select(COLUMNS)
    .eq('client_id', clientId)
    .order('date', { ascending: false })
    .order('slot', { ascending: false });
  if (error) throw failure(error);
  return data as unknown as ClientBooking[];
}

/**
 * "Active first" (FR §3.5): what is still going on, soonest first; then what has ended, newest
 * first.
 */
export function splitBookings(bookings: readonly ClientBooking[]): { active: ClientBooking[]; past: ClientBooking[] } {
  const when = (b: ClientBooking) => `${b.date} ${b.slot}`;
  const active = bookings.filter((b) => isActiveStatus(b.status)).sort((a, b) => when(a).localeCompare(when(b)));
  const past = bookings.filter((b) => !isActiveStatus(b.status)).sort((a, b) => when(b).localeCompare(when(a)));
  return { active, past };
}
