import { nowKey } from './shopBookings';
import type { BookingStatus } from './status';

/**
 * The client's Programări (FR §3.5, P10b, P15, P15c): which quote a booking shows, the partial
 * approval total, whether cancelling is still possible and whether a review can be left. Pure
 * logic; the database functions enforce the same rules (`decide_quote`, `cancel_booking`,
 * `submit_review`), the screen only mirrors them.
 */

export type QuoteStatus = 'sent' | 'accepted' | 'partially_accepted' | 'refused' | 'expired' | 'superseded' | 'withdrawn';

export interface QuoteItem {
  id: string;
  position: number;
  name: string;
  price: number;
  /** Null until the client decides. */
  approved: boolean | null;
}

export interface Quote {
  id: string;
  version: number;
  status: QuoteStatus;
  note: string | null;
  inspection_fee: number;
  total_sent: number;
  total_approved: number | null;
  sent_at: string;
  expires_at: string | null;
  decided_at: string | null;
  items: QuoteItem[];
}

const DECIDED: readonly QuoteStatus[] = ['accepted', 'partially_accepted'];

/** Which quote versions belong to each booking status (a replaced or withdrawn one never shows). */
const QUOTE_FOR: Partial<Record<BookingStatus, readonly QuoteStatus[]>> = {
  quote_sent: ['sent'],
  approved: DECIDED,
  in_progress: DECIDED,
  done: DECIDED,
  quote_refused: ['refused'],
  expired: ['expired'],
};

/** The quote the card shows: the newest version that matches the booking's status, or none. */
export function currentQuote(status: BookingStatus, quotes: readonly Quote[]): Quote | null {
  const wanted = QUOTE_FOR[status];
  if (!wanted) return null;
  let best: Quote | null = null;
  for (const q of quotes) if (wanted.includes(q.status) && (!best || q.version > best.version)) best = q;
  return best;
}

/** Total of the ticked lines, counted in bani so 0,1 + 0,2 stays 0,30. */
export function selectedTotal(items: readonly QuoteItem[], selected: ReadonlySet<string>): number {
  const bani = items.reduce((sum, i) => (selected.has(i.id) ? sum + Math.round(i.price * 100) : sum), 0);
  return bani / 100;
}

/**
 * "Accept" when every line is ticked, "Accept selectate" when some are, and a refusal when none are
 * (unticking everything is the same as refusing, inspection fee included).
 */
export function decisionKind(items: readonly QuoteItem[], selected: ReadonlySet<string>): 'all' | 'some' | 'none' {
  const n = items.filter((i) => selected.has(i.id)).length;
  return n === 0 ? 'none' : n === items.length ? 'all' : 'some';
}

export type CancelState = 'allowed' | 'deadline_passed' | 'not_allowed';

/**
 * Whether the client may cancel: a request (pending) always; a confirmed booking until
 * `cancel_deadline_hours` before its time (0 = no deadline); never once the car is in the workshop.
 */
export function cancelState(
  b: { status: BookingStatus; date: string; slot: string },
  deadlineHours: number,
  now: Date = new Date(),
): CancelState {
  if (b.status === 'pending') return 'allowed';
  if (b.status !== 'confirmed') return 'not_allowed';
  if (deadlineHours <= 0) return 'allowed';
  const limit = new Date(now.getTime() + deadlineHours * 3_600_000);
  return nowKey(limit) > `${b.date} ${b.slot.slice(0, 5)}` ? 'deadline_passed' : 'allowed';
}

export type ReviewState = 'open' | 'sent' | 'closed';

/**
 * A finished job can be reviewed once, within `windowDays` of completion; afterwards the card says
 * "Recenzie trimisă". Null for anything not finished.
 */
export function reviewState(
  b: { status: BookingStatus; done_at: string | null },
  hasReview: boolean,
  windowDays: number,
  now: Date = new Date(),
): ReviewState | null {
  if (b.status !== 'done') return null;
  if (hasReview) return 'sent';
  if (!b.done_at) return 'closed';
  return now.getTime() - new Date(b.done_at).getTime() < windowDays * 86_400_000 ? 'open' : 'closed';
}

/** Quotes waiting for the client's decision (the badge on the Programări tab). */
export function quotesWaiting(bookings: readonly { status: BookingStatus }[]): number {
  return bookings.filter((b) => b.status === 'quote_sent').length;
}
