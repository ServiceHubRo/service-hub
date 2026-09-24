export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'in_inspection'
  | 'quote_sent'
  | 'approved'
  | 'in_progress'
  | 'done'
  | 'declined'
  | 'cancelled'
  | 'quote_refused'
  | 'expired'
  | 'no_show';

export type StatusTone = 'amber' | 'green' | 'blue' | 'red' | 'muted';

// ARCHITECTURE §17 — always text + color, never color alone.
export const STATUS_TONE: Record<BookingStatus, StatusTone> = {
  pending: 'amber',
  confirmed: 'green',
  in_inspection: 'amber',
  quote_sent: 'amber',
  approved: 'green',
  in_progress: 'amber',
  done: 'blue',
  declined: 'red',
  cancelled: 'muted',
  quote_refused: 'muted',
  expired: 'muted',
  no_show: 'red',
};

export const BOOKING_STATUSES = Object.keys(STATUS_TONE) as BookingStatus[];

/** Statuses that still hold a place in the shop's calendar (ARCHITECTURE §3). */
const ACTIVE: ReadonlySet<BookingStatus> = new Set(['pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress']);

export function isActiveStatus(status: BookingStatus): boolean {
  return ACTIVE.has(status);
}
