import { call } from './rpc';
import type { CarSnapshot } from './bookings';

/**
 * No-shows (T53, ARCHITECTURE §6): what counts for a client, the acknowledgement before a booking
 * once it is needed, and the disputes the admin decides. The database counts and decides; these
 * calls only read and ask.
 */

export type NoShowDisputeStatus = 'pending' | 'upheld' | 'rejected';

/** A dispute as its client sees it (never the admin's internal note). */
export interface NoShowDispute {
  id: string;
  booking_id: string;
  reason: string;
  status: NoShowDisputeStatus;
  created_at: string;
  decided_at: string | null;
}

export interface NoShowSummary {
  /** No-shows that count: booked in the app, last 90 days, not annulled after a dispute. */
  count: number;
  window_days: number;
  /** From this many, every booking needs the acknowledgement. */
  ack_from: number;
  /** From this many, a phone confirmed by SMS (T25). */
  phone_from: number;
  phone_verified: boolean;
  disputes: NoShowDispute[];
  /** The client's no-shows that may still be contested (booking ids). */
  disputable: string[];
}

export async function fetchNoShowSummary(): Promise<NoShowSummary> {
  const raw = (await call('my_no_show_summary', {} as never)) as unknown as NoShowSummary;
  return { ...raw, disputes: raw.disputes ?? [], disputable: raw.disputable ?? [] };
}

/** True when the next booking needs the acknowledgement. */
export function needsAcknowledgement(s: Pick<NoShowSummary, 'count' | 'ack_from'>): boolean {
  return s.count >= s.ack_from;
}

/** "I will come and tell the shop in time if I cannot": used by the next booking, within 30 minutes. */
export async function acknowledgeNoShowNotice(requestId: string): Promise<void> {
  await call('acknowledge_no_show_notice', { p_request_id: requestId });
}

export async function disputeNoShow(bookingId: string, reason: string, requestId: string): Promise<NoShowDispute> {
  return (await call('dispute_no_show', {
    p_booking_id: bookingId,
    p_reason: reason,
    p_request_id: requestId,
  })) as unknown as NoShowDispute;
}

/** The reason's length the database accepts. */
export const DISPUTE_REASON_MIN = 10;
export const DISPUTE_REASON_MAX = 1000;

// ------------------------------------------------------------------------------------ admin (Moderare)

export interface AdminNoShowDispute extends NoShowDispute {
  decision_note: string | null;
  decided_by: string | null;
  booking: {
    id: string;
    ref: string;
    date: string;
    slot: string;
    status_changed_at: string;
    note: string | null;
    car_snapshot: CarSnapshot;
    service_ro: string | null;
    service_en: string | null;
    shop_id: string;
    shop_name: string;
    shop_city: string | null;
    shop_phone: string | null;
  } | null;
  client: {
    id: string;
    display_id: string | null;
    name: string | null;
    phone: string | null;
    email: string | null;
    /** No-shows that count now (this one included while it waits). */
    no_shows: number;
    disputes: number;
  } | null;
}

export interface AdminNoShowDisputes {
  pending: AdminNoShowDispute[];
  /** The last 30 decided. */
  decided: AdminNoShowDispute[];
}

export async function fetchNoShowDisputes(): Promise<AdminNoShowDisputes> {
  const raw = (await call('admin_list_no_show_disputes', {} as never)) as unknown as AdminNoShowDisputes;
  return { pending: raw.pending ?? [], decided: raw.decided ?? [] };
}

export type NoShowDecision = 'upheld' | 'rejected';

export async function decideNoShowDispute(
  disputeId: string,
  decision: NoShowDecision,
  note: string,
  requestId: string,
): Promise<AdminNoShowDispute> {
  return (await call('admin_decide_no_show_dispute', {
    p_dispute_id: disputeId,
    p_decision: decision,
    p_note: note,
    p_request_id: requestId,
  })) as unknown as AdminNoShowDispute;
}
