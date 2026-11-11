import type { RequestHold } from './legalHolds';
import { call } from './rpc';
import type { RequestFile } from './supportFiles';

/**
 * Support requests (A3a): the suggestions table extended into one support system. The author reads
 * and writes through my_support_requests / get_my_support_request / create_support_request /
 * reply_my_support_request; the team (agent or admin) through the support_* functions; the internal
 * notes reach only the team's screens (support_get_request).
 */

export const REQUEST_STATUSES = ['new', 'in_progress', 'waiting_user', 'resolved', 'closed', 'planned', 'done', 'declined'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** The states the team may set, by category (the suggestions keep their own). */
export function settableStatuses(category: string): RequestStatus[] {
  return category === 'suggestions' ? ['new', 'planned', 'done', 'declined', 'closed'] : ['in_progress', 'waiting_user', 'resolved', 'closed'];
}

/** The author may still write and the team still has to answer. */
export function isOpen(status: RequestStatus): boolean {
  return status === 'new' || status === 'in_progress' || status === 'waiting_user' || status === 'planned';
}

export interface SupportCategory {
  key: string;
  name_ro: string;
  name_en: string;
}

export const REQUEST_TITLE_MIN = 3;
export const REQUEST_TITLE_MAX = 120;
export const REQUEST_BODY_MAX = 4000;
export const REQUEST_REASON_MAX = 500;

export interface BookingRef {
  ref: string;
  date: string;
  status: string;
  shop_name: string;
}

// ------------------------------------------------------------------ the author

export interface MyRequest {
  id: string;
  title: string;
  category: string;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
  last_staff_message_at: string | null;
  unread: boolean;
}

export interface RequestMessage {
  id: string;
  from_staff: boolean;
  body: string;
  created_at: string;
}

export interface MyRequestDetail {
  id: string;
  title: string;
  has_title: boolean;
  body: string;
  category: string;
  status: RequestStatus;
  created_at: string;
  booking: BookingRef | null;
  reopen_until: string | null;
  can_reply: boolean;
  messages: RequestMessage[];
  /** A3b: the files sent with the description (message_id null) and with the messages. */
  files: RequestFile[];
}

export async function fetchSupportCategories(): Promise<SupportCategory[]> {
  return (await call('support_categories_for_me', {} as never)) as unknown as SupportCategory[];
}

export async function fetchMyRequests(): Promise<MyRequest[]> {
  return (await call('my_support_requests', {} as never)) as unknown as MyRequest[];
}

export async function fetchMyRequest(id: string): Promise<MyRequestDetail> {
  return (await call('get_my_support_request', { p_id: id })) as unknown as MyRequestDetail;
}

export async function createRequest(
  input: { category: string; title: string; body: string; bookingRef: string; fileIds?: string[] },
  requestId: string,
): Promise<{ id: string }> {
  return (await call('create_support_request', {
    p_category: input.category,
    p_title: input.title,
    p_body: input.body,
    p_booking_ref: input.bookingRef,
    p_request_id: requestId,
    p_file_ids: input.fileIds ?? [],
  })) as unknown as { id: string };
}

export async function replyMyRequest(
  id: string,
  body: string,
  requestId: string,
  fileIds: string[] = [],
): Promise<{ status: RequestStatus; reopened: boolean }> {
  return (await call('reply_my_support_request', { p_id: id, p_body: body, p_request_id: requestId, p_file_ids: fileIds })) as unknown as {
    status: RequestStatus;
    reopened: boolean;
  };
}

// ------------------------------------------------------------------ the team

export interface StaffRef {
  id: string;
  display_id: string;
  name: string | null;
  role: 'support' | 'admin';
}

export interface StaffRequestItem {
  id: string;
  title: string;
  category: string;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
  author: { id: string | null; display_id: string | null; name: string | null; role: 'client' | 'shop' };
  shop_name: string | null;
  assigned: StaffRef | null;
  escalated: boolean;
  escalated_at: string | null;
  first_response_at: string | null;
  last_user_message_at: string;
  last_staff_message_at: string | null;
  /** The author waits for an answer since then. */
  waiting_since: string | null;
  /** A3c2a, admin only: a legal hold covers it; the ID of its author once the account is gone. */
  held?: boolean;
  former_author?: string | null;
}

export interface StaffMessage extends RequestMessage {
  by: StaffRef | null;
}

export interface StaffNote {
  id: string;
  body: string;
  created_at: string;
  by: Partial<StaffRef> | null;
}

export interface StaffRequestDetail {
  id: string;
  title: string;
  body: string;
  category: string;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
  author: {
    id: string;
    display_id: string;
    role: 'client' | 'shop';
    name: string | null;
    email_masked: string | null;
    state: 'active' | 'suspended' | 'deleted';
  } | null;
  author_role: 'client' | 'shop';
  booking: BookingRef | null;
  assigned: StaffRef | null;
  assigned_at: string | null;
  escalated_at: string | null;
  escalation_reason: string | null;
  escalated_by: StaffRef | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  reopen_until: string | null;
  messages: StaffMessage[];
  notes: StaffNote[];
  /** A3b: the files; for the admin with who opened each. */
  files: RequestFile[];
  /** A3c2a, admin only: the active holds covering it, and its author once the account is gone. */
  legal_holds?: RequestHold[];
  former_author?: { display_id: string; role: 'client' | 'shop' | null } | null;
}

/** A3c1: where the next page starts (the last row of the previous one). */
export interface InboxCursor {
  open: boolean;
  at: string;
  id: string;
}

export interface InboxPage {
  me: string;
  items: StaffRequestItem[];
  /** Null on the last page. */
  next: InboxCursor | null;
}

/** The list's filters as the database takes them (see lib/supportRequests inboxArgs). */
export interface InboxQuery {
  owner: string;
  status: string;
  category: string;
  age: 24 | 48 | null;
}

export const INBOX_PAGE = 30;

/** One page of the team's list, filtered and ordered in the database (A3c1). */
export async function fetchInbox(q: InboxQuery, after: InboxCursor | null = null, limit = INBOX_PAGE): Promise<InboxPage> {
  return (await call('support_inbox', {
    p_owner: q.owner,
    p_status: q.status,
    p_category: q.category,
    p_age: q.age ?? undefined,
    p_after_open: after?.open,
    p_after_at: after?.at,
    p_after_id: after?.id,
    p_limit: limit,
  })) as unknown as InboxPage;
}

export interface SupportCounts {
  new: number;
  in_progress: number;
  waiting_user: number;
  resolved: number;
  closed: number;
  escalated: number;
  unassigned: number;
  mine: number;
  over_24: number;
  over_48: number;
  /** A3c2a, admin only: legal holds past their review date. */
  holds_due?: number;
  /** A3c2b1: suggestions whose text waits for a check, and those due within 7 days. */
  reviews?: number;
  reviews_soon?: number;
}

export interface SupportDashboard {
  me: string;
  /** The database's clock: waiting is measured from it. */
  now: string;
  counts: SupportCounts;
  /** The request whose author has waited longest for an answer; null when every one has an answer. */
  oldest: { id: string; title: string; waiting_since: string; escalated: boolean; assigned: StaffRef | null } | null;
}

export async function fetchSupportDashboard(): Promise<SupportDashboard> {
  return (await call('support_dashboard', {} as never)) as unknown as SupportDashboard;
}

export async function listStaff(): Promise<StaffRef[]> {
  return (await call('support_list_staff', {} as never)) as unknown as StaffRef[];
}

export async function getRequest(id: string): Promise<StaffRequestDetail> {
  return (await call('support_get_request', { p_id: id })) as unknown as StaffRequestDetail;
}

export async function takeRequest(id: string, requestId: string): Promise<void> {
  await call('support_take_request', { p_id: id, p_request_id: requestId });
}

export async function assignRequest(id: string, assignee: string, requestId: string): Promise<void> {
  await call('support_assign_request', { p_id: id, p_assignee: assignee, p_request_id: requestId });
}

export async function replyRequest(
  id: string,
  body: string,
  status: RequestStatus | null,
  requestId: string,
  fileIds: string[] = [],
): Promise<void> {
  await call('support_reply_request', { p_id: id, p_body: body, p_status: status as string, p_request_id: requestId, p_file_ids: fileIds });
}

export async function addNote(id: string, body: string, requestId: string): Promise<void> {
  await call('support_add_note', { p_id: id, p_body: body, p_request_id: requestId });
}

export async function setRequestStatus(id: string, status: RequestStatus, requestId: string): Promise<void> {
  await call('support_set_request_status', { p_id: id, p_status: status, p_request_id: requestId });
}

export async function escalateRequest(id: string, reason: string, requestId: string): Promise<void> {
  await call('support_escalate_request', { p_id: id, p_reason: reason, p_request_id: requestId });
}

export async function returnRequest(id: string, reason: string, requestId: string): Promise<void> {
  await call('admin_return_request', { p_id: id, p_reason: reason, p_request_id: requestId });
}
