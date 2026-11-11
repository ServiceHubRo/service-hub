import { call } from './rpc';
import type { RequestStatus, StaffRef } from './supportRequests';

/**
 * Legal hold of support data (A3c2a). Admin only: every answer comes from an admin_* database
 * function (second step required); the hold tables have no grant at all, not even for the service key.
 */

/** The closed list of bases (presented to Eduard for validation before it is published). */
export const LEGAL_HOLD_BASES = ['litigation', 'authority_request', 'official_complaint', 'fraud_investigation'] as const;
export type LegalHoldBasis = (typeof LEGAL_HOLD_BASES)[number];

/** The same limits as the database (legal_holds checks). */
export const HOLD_TEXT_MIN = 30;
export const HOLD_TEXT_MAX = 1000;
export const HOLD_REFERENCE_MIN = 3;
export const HOLD_REFERENCE_MAX = 200;

export interface LegalHold {
  id: string;
  scope: 'request' | 'account';
  request: { id: string; title: string; status: RequestStatus } | null;
  account: { id: string; display_id: string; deleted: boolean };
  basis: LegalHoldBasis;
  reason: string;
  reference: string;
  responsible: StaffRef | null;
  created_by: StaffRef | null;
  created_at: string;
  review_due_at: string;
  reviewed_at: string | null;
  released_at: string | null;
  released_by: StaffRef | null;
  release_reason: string | null;
  /** How many requests it covers now. */
  requests: number;
}

export interface LegalHoldDetail extends LegalHold {
  reviews: { at: string; by: StaffRef | null; note: string; next_due_at: string }[];
  /** The author's identifiers, while the hold is active. */
  subject: {
    display_id: string;
    role: 'client' | 'shop' | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    account_deleted_at: string | null;
    captured_at: string;
  } | null;
  covered: { id: string; title: string; status: RequestStatus; created_at: string; author_deleted: boolean }[];
}

export interface LegalHoldList {
  now: string;
  /** Active holds past their review date. */
  due: number;
  items: LegalHold[];
}

/** A hold as the admin's request page lists it. */
export interface RequestHold {
  id: string;
  scope: 'request' | 'account';
  basis: LegalHoldBasis;
  review_due_at: string;
}

export async function listLegalHolds(state: 'active' | 'released'): Promise<LegalHoldList> {
  return (await call('admin_list_legal_holds', { p_state: state })) as unknown as LegalHoldList;
}

export async function getLegalHold(id: string): Promise<LegalHoldDetail> {
  return (await call('admin_get_legal_hold', { p_id: id })) as unknown as LegalHoldDetail;
}

export async function listAdmins(): Promise<StaffRef[]> {
  return (await call('admin_list_admins', {} as never)) as unknown as StaffRef[];
}

export interface PlaceHold {
  /** One request, or one account (its ID, e.g. C-00012). */
  request?: string;
  account?: string;
  basis: LegalHoldBasis;
  reason: string;
  reference: string;
  responsible: string | null;
}

export async function placeLegalHold(p: PlaceHold, requestId: string): Promise<{ id: string }> {
  return (await call('admin_place_legal_hold', {
    p_suggestion: p.request ?? null,
    p_account: p.account ?? null,
    p_basis: p.basis,
    p_reason: p.reason,
    p_reference: p.reference,
    p_responsible: p.responsible,
    p_request_id: requestId,
  } as never)) as unknown as { id: string };
}

export async function reviewLegalHold(
  id: string,
  note: string,
  responsible: string | null,
  requestId: string,
): Promise<{ review_due_at: string }> {
  return (await call('admin_review_legal_hold', {
    p_id: id,
    p_note: note,
    p_responsible: responsible,
    p_request_id: requestId,
  } as never)) as unknown as { review_due_at: string };
}

export async function releaseLegalHold(
  id: string,
  reason: string,
  requestId: string,
): Promise<{ deleted_requests: number; deleted_files: number }> {
  return (await call('admin_release_legal_hold', { p_id: id, p_reason: reason, p_request_id: requestId } as never)) as unknown as {
    deleted_requests: number;
    deleted_files: number;
  };
}

/** True when the review date has passed. */
export function reviewOverdue(hold: Pick<LegalHold, 'review_due_at' | 'released_at'>, now: Date = new Date()): boolean {
  return hold.released_at === null && new Date(hold.review_due_at).getTime() <= now.getTime();
}
