import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import type { BookingStatus } from '../lib/status';
import type { Json } from './database.types';
import { call, failure, RpcError, type ReportReason } from './rpc';
import { supabase } from './supabase';

/**
 * The admin interface (T16a, FR §5.1–5.5, §5.8). Every screen reads one admin-only database
 * function (the database refuses anyone else) and every action is a function that writes the audit
 * log in the same transaction. Deleting an account goes through the Edge Function
 * `admin-delete-account` (it needs the Auth API).
 */

// ------------------------------------------------------------------------------------ shared shapes

export type ShopState = 'active' | 'trial' | 'inactive' | 'suspended' | 'deleted';
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'cancelled' | 'inactive';
export type ReportStatus = 'pending' | 'kept' | 'removed';

export interface CarSnapshot {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  plate?: string | null;
  vin?: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
  admin_display_id: string | null;
  admin_name: string | null;
  /** Only in the full log: the shop's name, the booking's code, the account id. */
  label?: string | null;
}

// ------------------------------------------------------------------------------------ overview

export interface BookingWindow {
  total: number;
  by_status: Partial<Record<BookingStatus, number>>;
}

export type ActivityItem =
  | { kind: 'shop_created'; at: string; id: string; name: string; city: string }
  | { kind: 'client_created'; at: string; id: string; name: string | null; display_id: string }
  | {
      kind: 'booking_created';
      at: string;
      id: string;
      ref: string;
      name: string;
      status: BookingStatus;
      service_ro: string | null;
      service_en: string | null;
    }
  | { kind: 'review_reported'; at: string; id: string; name: string; reason: ReportReason; rating: number; status: ReportStatus }
  | { kind: 'payment_failed'; at: string; id: string; name: string };

export interface AdminOverview {
  shops: Record<'active' | 'trial' | 'inactive' | 'suspended' | 'total', number>;
  clients: number;
  bookings: Record<'today' | 'week' | 'month', BookingWindow>;
  reports_pending: number;
  subscriptions: { active: number; past_due: number; trial: number; trial_ending: number; mrr: number };
  activity: ActivityItem[];
}

export async function fetchOverview(): Promise<AdminOverview> {
  return (await call('admin_overview', {} as never)) as unknown as AdminOverview;
}

// ------------------------------------------------------------------------------------ shops

export interface AdminShopRow {
  id: string;
  name: string;
  city: string;
  phone: string | null;
  owner_id: string;
  display_id: string;
  owner_name: string | null;
  email: string | null;
  email_verified: boolean;
  phone_verified: boolean;
  state: ShopState;
  public: boolean;
  subscription_status: SubscriptionStatus | null;
  trial_ends_at: string | null;
  created_at: string;
  last_active_at: string | null;
}

export async function fetchShops(): Promise<AdminShopRow[]> {
  return (await call('admin_list_shops', {} as never)) as unknown as AdminShopRow[];
}

export interface AdminShop {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  street: string | null;
  city: string;
  county: string | null;
  postal_code: string | null;
  phone: string | null;
  phone2: string | null;
  website: string | null;
  facebook: string | null;
  year_established: number | null;
  latitude: number | null;
  longitude: number | null;
  daily_capacity: number;
  cars_per_slot: number;
  slot_minutes: number;
  min_notice_hours: number;
  max_advance_days: number;
  cancel_deadline_hours: number;
  inspection_fee: number;
  sms_on_new_booking: boolean;
  daily_digest: boolean;
  active: boolean;
  suspended: boolean;
  setup_completed_at: string | null;
  created_at: string;
}

export interface AdminBilling {
  legal_name: string | null;
  vat_id: string | null;
  reg_com: string | null;
  legal_address: string | null;
  vat_payer: boolean;
  bank_name: string | null;
  iban: string | null;
  billing_email: string | null;
  legal_rep: string | null;
}

export interface AdminSubscription {
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  price_ron: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_status: string | null;
  ended_reason: string | null;
  status_changed_at: string | null;
  payment_failed_at: string | null;
  next_payment_attempt: string | null;
}

export interface AdminBookingRow {
  id: string;
  ref: string;
  status: BookingStatus;
  date: string;
  slot: string;
  client_name: string | null;
  service_ro: string | null;
  service_en: string | null;
  car_snapshot: CarSnapshot;
}

export interface AdminShopDetail {
  shop: AdminShop;
  owner: {
    id: string;
    display_id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    lang: string;
    email_verified_at: string | null;
    phone_verified_at: string | null;
    phone_verified_by_admin: boolean;
    suspended: boolean;
    deleted_at: string | null;
    created_at: string;
    last_active_at: string | null;
  };
  state: ShopState;
  public: boolean;
  reasons: string[];
  billing: AdminBilling | null;
  hours: { weekday: number; is_closed: boolean; open_time: string | null; close_time: string | null }[];
  closures: { start_date: string; end_date: string; label: string | null }[];
  services: { id: string; name_ro: string; name_en: string; enabled: boolean }[];
  subscription: AdminSubscription | null;
  invoices: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    issued_at: string;
    provider_ref: string | null;
    receipt_url: string | null;
    series: string | null;
    number: string | null;
  }[];
  staff: {
    id: string;
    role: 'owner' | 'staff';
    user_id: string | null;
    display_id: string | null;
    name: string | null;
    email: string | null;
    invited_at: string;
    accepted_at: string | null;
  }[];
  rating: { average: number | null; review_count: number } | null;
  booking_counts: Partial<Record<BookingStatus, number>>;
  bookings: AdminBookingRow[];
  reviews: {
    id: string;
    rating: number;
    text: string | null;
    reply: string | null;
    client_display_name: string;
    report_status: ReportStatus | null;
    report_reason: ReportReason | null;
    removed_at: string | null;
    created_at: string;
  }[];
  audit: AuditEntry[];
}

export async function fetchShop(shopId: string): Promise<AdminShopDetail> {
  return (await call('admin_get_shop', { p_shop_id: shopId })) as unknown as AdminShopDetail;
}

// ------------------------------------------------------------------------------------ clients

export interface AdminClientRow {
  id: string;
  display_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  email_verified: boolean;
  suspended: boolean;
  created_at: string;
  last_active_at: string | null;
  bookings: number;
  active_bookings: number;
  no_shows: number;
}

export async function fetchClients(): Promise<AdminClientRow[]> {
  return (await call('admin_list_clients', {} as never)) as unknown as AdminClientRow[];
}

export interface AdminClientDetail {
  profile: {
    id: string;
    display_id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    lang: string;
    email_verified_at: string | null;
    suspended: boolean;
    deleted_at: string | null;
    created_at: string;
    terms_version: string | null;
    last_active_at: string | null;
  };
  no_shows: number;
  cars: {
    id: string;
    make: string;
    model: string;
    year: number | null;
    plate: string | null;
    vin: string | null;
    itp_expiry: string | null;
    rca_expiry: string | null;
    vignette_expiry: string | null;
  }[];
  bookings: (AdminBookingRow & { shop_id: string; shop_name: string; cost: number | null })[];
  reviews: {
    id: string;
    rating: number;
    text: string | null;
    shop_name: string;
    report_status: ReportStatus | null;
    removed_at: string | null;
    created_at: string;
  }[];
  threads: { id: string; shop_id: string; shop_name: string; last_message_at: string | null; messages: number }[];
  audit: AuditEntry[];
}

export async function fetchClient(userId: string): Promise<AdminClientDetail> {
  return (await call('admin_get_client', { p_user_id: userId })) as unknown as AdminClientDetail;
}

// ------------------------------------------------------------------------------------ bookings

export interface BookingFilters {
  statuses?: BookingStatus[];
  shopId?: string;
  clientId?: string;
  /** YYYY-MM-DD, the appointment day (Bucharest). */
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
}

export interface AdminBookingListRow extends AdminBookingRow {
  shop_id: string;
  shop_name: string;
  shop_city: string;
  client_id: string | null;
  client_display_id: string | null;
  service_id: string;
  service_icon: string | null;
  cost: number | null;
  created_at: string;
}

export interface AdminBookingList {
  total: number;
  bookings: AdminBookingListRow[];
}

export async function fetchBookings(f: BookingFilters): Promise<AdminBookingList> {
  return (await call('admin_list_bookings', {
    p_statuses: f.statuses && f.statuses.length > 0 ? f.statuses : undefined,
    p_shop_id: f.shopId,
    p_client_id: f.clientId,
    p_from: f.from,
    p_to: f.to,
    p_q: f.q?.trim() ? f.q.trim() : undefined,
    p_limit: f.limit,
  })) as unknown as AdminBookingList;
}

export interface AdminMessage {
  id: string;
  kind: 'user' | 'system';
  body: string | null;
  event: string | null;
  params: Record<string, unknown>;
  booking_id: string | null;
  created_at: string;
  side: 'client' | 'shop' | 'system' | 'unknown';
  sender_name: string | null;
}

export interface AdminQuote {
  id: string;
  version: number;
  status: string;
  note: string | null;
  inspection_fee: number;
  total_sent: number;
  total_approved: number | null;
  sent_at: string;
  expires_at: string | null;
  decided_at: string | null;
  items: { id: string; name: string; price: number; approved: boolean | null }[];
}

export interface AdminBookingDetail {
  booking: {
    id: string;
    ref: string;
    status: BookingStatus;
    date: string;
    slot: string;
    note: string | null;
    shop_id: string;
    client_id: string | null;
    client_name: string | null;
    client_phone: string | null;
    car_snapshot: CarSnapshot;
    created_at: string;
    confirmed_at: string | null;
    inspection_started_at: string | null;
    started_at: string | null;
    done_at: string | null;
    cancelled_at: string | null;
    cancelled_by: 'client' | 'shop' | 'admin' | null;
    cancel_reason: string | null;
    decline_reason: string | null;
    work: string | null;
    cost: number | null;
    odometer: number | null;
  };
  service: { id: string; name_ro: string; name_en: string; icon: string } | null;
  shop: { id: string; name: string; city: string; phone: string | null; display_id: string } | null;
  client: { id: string; display_id: string; name: string | null; phone: string | null; email: string | null; no_shows: number } | null;
  quotes: AdminQuote[];
  review: {
    id: string;
    rating: number;
    text: string | null;
    reply: string | null;
    report_status: ReportStatus | null;
    removed_at: string | null;
    created_at: string;
  } | null;
  thread_id: string | null;
  messages: AdminMessage[];
  audit: AuditEntry[];
}

export async function fetchBooking(bookingId: string): Promise<AdminBookingDetail> {
  return (await call('admin_get_booking', { p_booking_id: bookingId })) as unknown as AdminBookingDetail;
}

export interface AdminThread {
  thread: {
    id: string;
    shop_id: string;
    client_id: string | null;
    client_name: string | null;
    client_display_id: string | null;
    shop_name: string;
    last_message_at: string | null;
  };
  messages: AdminMessage[];
}

export async function fetchThread(threadId: string): Promise<AdminThread> {
  return (await call('admin_get_thread', { p_thread_id: threadId })) as unknown as AdminThread;
}

// ------------------------------------------------------------------------------------ moderation

export interface AdminReview {
  id: string;
  booking_id: string;
  shop_id: string;
  client_id: string | null;
  client_display_name: string;
  client_display_id: string | null;
  rating: number;
  text: string | null;
  reply: string | null;
  report_reason: ReportReason | null;
  reported_at: string | null;
  report_status: ReportStatus | null;
  report_decided_at: string | null;
  report_note: string | null;
  removed_at: string | null;
  created_at: string;
  ref: string | null;
  shop_name: string;
  shop_city: string;
}

export interface AdminReviews {
  /** Reported and waiting for a decision, oldest first. */
  queue: AdminReview[];
  /** The newest reviews of the platform (at most 200), filtered by the text. */
  reviews: AdminReview[];
}

export async function fetchReviews(q?: string): Promise<AdminReviews> {
  return (await call('admin_list_reviews', { p_q: q?.trim() ? q.trim() : undefined })) as unknown as AdminReviews;
}

/** Reported reviews waiting for a decision: the badge on Moderare (RLS lets the admin count them). */
export async function countPendingReports(): Promise<number> {
  if (!supabase) throw new RpcError('network');
  const { count, error } = await supabase
    .from('reviews')
    .select('id', { count: 'exact', head: true })
    .eq('report_status', 'pending');
  if (error) throw failure(error);
  return count ?? 0;
}

// ------------------------------------------------------------------------------------ audit log

export const AUDIT_PAGE = 100;

/** The audit log, newest first; `before` = the time of the oldest entry already shown. */
export async function fetchAudit(before?: string): Promise<AuditEntry[]> {
  return (await call('admin_list_audit', { p_before: before, p_limit: AUDIT_PAGE })) as unknown as AuditEntry[];
}

// ------------------------------------------------------------------------------------ actions

export function verifyPhone(userId: string, requestId: string): Promise<Json> {
  return call('admin_verify_phone', { p_user_id: userId, p_request_id: requestId });
}

export function setShopSuspended(shopId: string, suspended: boolean, reason: string, requestId: string): Promise<Json> {
  return call('admin_set_shop_suspended', {
    p_shop_id: shopId,
    p_suspended: suspended,
    p_reason: reason,
    p_request_id: requestId,
  });
}

export function setAccountSuspended(userId: string, suspended: boolean, reason: string, requestId: string): Promise<Json> {
  return call('admin_set_account_suspended', {
    p_user_id: userId,
    p_suspended: suspended,
    p_reason: reason,
    p_request_id: requestId,
  });
}

export type ShopEdit = Partial<Record<keyof AdminShop, string | number | null>>;
export type BillingEdit = Partial<Record<keyof AdminBilling, string | boolean | null>>;

export interface ShopEditResult {
  shop: AdminShop;
  billing: AdminBilling | null;
  address_changed: boolean;
}

export async function updateShop(shopId: string, shop: ShopEdit, billing: BillingEdit, requestId: string): Promise<ShopEditResult> {
  return (await call('admin_update_shop', {
    p_shop_id: shopId,
    p_shop: shop as Json,
    p_billing: billing as Json,
    p_request_id: requestId,
  })) as unknown as ShopEditResult;
}

export async function extendTrial(shopId: string, days: number, requestId: string): Promise<AdminSubscription> {
  return (await call('admin_extend_trial', { p_shop_id: shopId, p_days: days, p_request_id: requestId })) as unknown as AdminSubscription;
}

export type ManualStatus = Exclude<SubscriptionStatus, 'trial'>;
export const MANUAL_STATUSES: readonly ManualStatus[] = ['active', 'past_due', 'cancelled', 'inactive'];

export async function setSubscriptionStatus(shopId: string, status: ManualStatus, requestId: string): Promise<AdminSubscription> {
  return (await call('admin_set_subscription_status', {
    p_shop_id: shopId,
    p_status: status,
    p_request_id: requestId,
  })) as unknown as AdminSubscription;
}

export type ReviewDecision = 'keep' | 'remove';

export async function decideReview(reviewId: string, decision: ReviewDecision, note: string, requestId: string): Promise<AdminReview> {
  return (await call('admin_decide_review', {
    p_review_id: reviewId,
    p_decision: decision,
    p_note: note,
    p_request_id: requestId,
  })) as unknown as AdminReview;
}

/**
 * Deletes a client's account or a shop (its owner's account) — Edge Function
 * `admin-delete-account`. A shop with records is anonymized instead (kept by law). Refusals
 * (active bookings) arrive as RpcError codes.
 */
export async function deleteAccount(userId: string): Promise<'delete' | 'anonymize'> {
  if (!supabase) throw new RpcError('network');
  const { data, error } = await supabase.functions.invoke('admin-delete-account', { method: 'POST', body: { user_id: userId } });
  if (!error) return (data as { mode?: string }).mode === 'anonymize' ? 'anonymize' : 'delete';
  if (error instanceof FunctionsFetchError) throw new RpcError('network');
  if (error instanceof FunctionsHttpError) {
    let code: unknown;
    try {
      code = ((await (error.context as Response).json()) as { error?: unknown }).error;
    } catch {
      code = null;
    }
    throw failure({ message: code });
  }
  throw new RpcError('unknown');
}

/** After the admin changed a shop's address: its map position is looked up again (best effort). */
export async function geocodeShopAsAdmin(shopId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.functions.invoke('geocode', { method: 'POST', body: { shop_id: shopId } });
  } catch {
    // The address is saved; the position follows on the next change.
  }
}
