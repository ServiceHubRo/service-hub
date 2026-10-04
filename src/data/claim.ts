import { storage } from '../lib/storage';
import type { BookingStatus } from '../lib/status';
import type { ExtraService } from '../lib/bookingServices';
import { call } from './rpc';

/**
 * The link a shop's SMS carries (T29): `/p/<token>`. Anyone holding it sees what the booking is
 * about (no personal data); a client with the same verified phone or email takes it, with every
 * other booking shops added for that phone, into the account.
 */

export interface InvitePreview {
  shop_name: string;
  shop_city: string;
  date: string; // YYYY-MM-DD, Europe/Bucharest
  slot: string; // HH:MM
  status: BookingStatus;
  services: ExtraService[];
  car: { make: string | null; model: string | null };
  /** Some account has taken it. */
  claimed: boolean;
  /** The caller's own account has. */
  mine: boolean;
}

/** Null for a link that does not exist (mistyped, or the booking is gone). */
export async function invitePreview(token: string): Promise<InvitePreview | null> {
  const data = await call('invite_preview', { p_token: token });
  return (data as unknown as InvitePreview | null) ?? null;
}

export interface ClaimResult {
  booking_id: string;
  /** How many bookings came into the account (0 when it was already there). */
  claimed: number;
}

export async function claimBooking(token: string): Promise<ClaimResult> {
  return (await call('claim_booking', {
    p_token: token,
  })) as unknown as ClaimResult;
}

/** 16 hex characters, as the database makes them. */
export function isInviteToken(value: string | undefined): value is string {
  return !!value && /^[0-9a-f]{16}$/.test(value);
}

export function claimPath(token: string): string {
  return `/c/preia/${token}`;
}

// A visitor who opened the link and went on to create an account confirms the email first; the
// confirmation link may open in another tab. The token waits here until the client app takes it.
const PENDING_KEY = 'sh.claim';

export function rememberClaim(token: string): void {
  storage.set(PENDING_KEY, token);
}

export function pendingClaim(): string | null {
  const value = storage.get(PENDING_KEY) ?? undefined;
  return isInviteToken(value) ? value : null;
}

export function forgetClaim(): void {
  storage.remove(PENDING_KEY);
}
