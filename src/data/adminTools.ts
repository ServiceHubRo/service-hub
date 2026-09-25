import type { BookingStatus } from '../lib/status';
import type { Json } from './database.types';
import type { ReportStatus } from './reports';
import type { ReportReason } from './rpc';
import { call, failure, RpcError } from './rpc';
import { supabase } from './supabase';
import type { CarSnapshot, ShopState, SubscriptionStatus } from './admin';

/**
 * The admin's platform tools (T16b, FR §5.6–5.11): subscriptions and payments, history reports,
 * the service catalog, platform settings and push texts, notices, CSV exports. Every read is an
 * admin-only database function (settings: the table itself, readable by everyone signed in);
 * every change writes the audit log in the same transaction.
 */

// ------------------------------------------------------------------------------------ subscriptions

export interface AdminSubscriptionRow {
  shop_id: string;
  shop_name: string;
  city: string;
  display_id: string;
  owner_name: string | null;
  email: string | null;
  state: ShopState;
  status: SubscriptionStatus;
  stripe_status: string | null;
  price_ron: number;
  /** Price per colleague with an account, how many there are, and how many Stripe charges now. */
  seat_price_ron: number;
  seats: number;
  billed_seats: number | null;
  /** price_ron + seats × seat_price_ron. */
  monthly_ron: number;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  next_payment_attempt: string | null;
  /** The next date money is due: end of the free period, renewal, or Stripe's next retry. */
  next_billing: string | null;
  payment_failed_at: string | null;
  ended_reason: string | null;
  status_changed_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  paid_count: number;
  paid_total: number;
  created_at: string;
}

export type InvoiceStatus = 'paid' | 'issued' | 'failed' | 'void';

export interface AdminInvoiceRow {
  id: string;
  shop_id: string;
  shop_name: string;
  amount: number;
  vat_amount: number | null;
  currency: string;
  status: InvoiceStatus;
  issued_at: string;
  provider: string | null;
  provider_ref: string | null;
  stripe_invoice_id: string | null;
  receipt_url: string | null;
  pdf_url: string | null;
  series: string | null;
  number: string | null;
  period_end: string | null;
}

export interface AdminSubscriptions {
  subscriptions: AdminSubscriptionRow[];
  invoices: AdminInvoiceRow[];
}

export async function fetchSubscriptions(): Promise<AdminSubscriptions> {
  return (await call('admin_list_subscriptions', {} as never)) as unknown as AdminSubscriptions;
}

export function setSubscriptionPrice(shopId: string, price: number, requestId: string): Promise<Json> {
  return call('admin_set_subscription_price', { p_shop_id: shopId, p_price: price, p_request_id: requestId });
}

// ------------------------------------------------------------------------------------ history reports

export interface AdminReportRow {
  id: string;
  code: string;
  status: ReportStatus;
  client_id: string | null;
  client_display_id: string | null;
  client_name: string | null;
  car_snapshot: CarSnapshot;
  job_count: number;
  price: number;
  amount_paid: number;
  lang: 'ro' | 'en';
  created_at: string;
  paid_at: string | null;
  generated_at: string | null;
  void_reason: string | null;
  voided_at: string | null;
}

export async function fetchHistoryReports(): Promise<AdminReportRow[]> {
  return (await call('admin_list_history_reports', {} as never)) as unknown as AdminReportRow[];
}

export function voidHistoryReport(reportId: string, reason: string, requestId: string): Promise<Json> {
  return call('admin_void_history_report', { p_report_id: reportId, p_reason: reason, p_request_id: requestId });
}

// ------------------------------------------------------------------------------------ catalog

export interface CatalogService {
  id: string;
  category_key: string;
  icon: string | null;
  name_ro: string;
  name_en: string;
  position: number;
  enabled: boolean;
  /** Shops that offer it now. */
  shops: number;
  /** Bookings made for it (they keep pointing at the id). */
  bookings: number;
}

export interface CatalogCategory {
  key: string;
  name_ro: string;
  name_en: string;
  position: number;
  enabled: boolean;
  services: CatalogService[];
}

export async function fetchCatalog(): Promise<CatalogCategory[]> {
  return (await call('admin_list_catalog', {} as never)) as unknown as CatalogCategory[];
}

export function createCategory(key: string, nameRo: string, nameEn: string, requestId: string): Promise<Json> {
  return call('admin_create_category', { p_key: key, p_name_ro: nameRo, p_name_en: nameEn, p_request_id: requestId });
}

export function updateCategory(key: string, nameRo: string, nameEn: string, enabled: boolean, requestId: string): Promise<Json> {
  return call('admin_update_category', {
    p_key: key,
    p_name_ro: nameRo,
    p_name_en: nameEn,
    p_enabled: enabled,
    p_request_id: requestId,
  });
}

export interface ServiceInput {
  category_key: string;
  icon: string;
  name_ro: string;
  name_en: string;
}

export function createService(id: string, s: ServiceInput, requestId: string): Promise<Json> {
  return call('admin_create_service', {
    p_id: id,
    p_category_key: s.category_key,
    p_icon: s.icon,
    p_name_ro: s.name_ro,
    p_name_en: s.name_en,
    p_request_id: requestId,
  });
}

export function updateService(id: string, s: ServiceInput & { enabled: boolean }, requestId: string): Promise<Json> {
  return call('admin_update_service', {
    p_id: id,
    p_category_key: s.category_key,
    p_icon: s.icon,
    p_name_ro: s.name_ro,
    p_name_en: s.name_en,
    p_enabled: s.enabled,
    p_request_id: requestId,
  });
}

export function moveCatalogItem(kind: 'category' | 'service', id: string, direction: -1 | 1, requestId: string): Promise<Json> {
  return call('admin_move_catalog_item', { p_kind: kind, p_id: id, p_direction: direction, p_request_id: requestId });
}

// ------------------------------------------------------------------------------------ platform settings

export const LIMIT_KEYS = [
  'active_bookings_per_shop',
  'active_bookings_total',
  'new_bookings_per_24h',
  'messages_per_thread_per_hour',
  'review_window_days',
  'quote_versions_max',
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export interface NotificationTextOverride {
  title?: string;
  body?: string;
}
export type NotificationTexts = Record<string, Partial<Record<'ro' | 'en', NotificationTextOverride>>>;

export interface PlatformSettings {
  subscription_price_ron: number;
  /** Price per colleague with an account, a month (paid staff seats). */
  staff_seat_price_ron: number;
  trial_days: number;
  quote_expiry_days: number;
  report_price_ron: number;
  vat_rate_percent: number;
  ranking_prior_avg: number;
  ranking_prior_weight: number;
  default_daily_capacity: number;
  default_cars_per_slot: number;
  default_slot_minutes: number;
  default_min_notice_hours: number;
  default_max_advance_days: number;
  default_cancel_deadline_hours: number;
  limits: Record<LimitKey, number>;
  notification_texts: NotificationTexts;
  updated_at: string;
}

export type SettingKey = Exclude<keyof PlatformSettings, 'limits' | 'notification_texts' | 'updated_at'>;

export async function fetchSettings(): Promise<PlatformSettings> {
  if (!supabase) throw new RpcError('network');
  const { data, error } = await supabase.from('platform_settings').select('*').eq('id', 1).single();
  if (error) throw failure(error);
  return data as unknown as PlatformSettings;
}

export type SettingsChange = Partial<Record<SettingKey, number>> & { limits?: Partial<Record<LimitKey, number>> };

export async function updateSettings(change: SettingsChange, requestId: string): Promise<PlatformSettings> {
  return (await call('admin_update_settings', { p_settings: change as Json, p_request_id: requestId })) as unknown as PlatformSettings;
}

export interface TextInput {
  title_ro: string;
  body_ro: string;
  title_en: string;
  body_en: string;
}

export async function setNotificationText(key: string, text: TextInput, requestId: string): Promise<NotificationTexts> {
  return (await call('admin_set_notification_text', {
    p_key: key,
    p_title_ro: text.title_ro,
    p_body_ro: text.body_ro,
    p_title_en: text.title_en,
    p_body_en: text.body_en,
    p_request_id: requestId,
  })) as unknown as NotificationTexts;
}

// ------------------------------------------------------------------------------------ notices

export type NoticeAudience = 'shops' | 'clients' | 'all';
export const NOTICE_AUDIENCES: readonly NoticeAudience[] = ['clients', 'shops', 'all'];

export interface Notice {
  id: string;
  /** 'city' only on notices sent before T16b (everyone in that city). */
  audience: NoticeAudience | 'city';
  city: string | null;
  title_ro: string;
  body_ro: string;
  title_en: string;
  body_en: string;
  send_push: boolean;
  created_at: string;
}

export interface AdminNotice extends Notice {
  recipients: number;
  push_recipients: number;
  reads: number;
  created_by_name: string | null;
  created_by_display_id: string | null;
}

export interface NoticeDraft extends TextInput {
  audience: NoticeAudience;
  city: string;
  push: boolean;
}

export async function previewNotice(audience: NoticeAudience, city: string): Promise<{ recipients: number; with_push: number }> {
  return (await call('admin_notice_preview', { p_audience: audience, p_city: city })) as unknown as {
    recipients: number;
    with_push: number;
  };
}

export async function sendNotice(d: NoticeDraft, requestId: string): Promise<AdminNotice> {
  return (await call('admin_send_notice', {
    p_audience: d.audience,
    p_city: d.city,
    p_title_ro: d.title_ro,
    p_body_ro: d.body_ro,
    p_title_en: d.title_en,
    p_body_en: d.body_en,
    p_push: d.push,
    p_request_id: requestId,
  })) as unknown as AdminNotice;
}

export async function fetchNotices(): Promise<AdminNotice[]> {
  return (await call('admin_list_notices', {} as never)) as unknown as AdminNotice[];
}

export function withdrawNotice(noticeId: string, requestId: string): Promise<Json> {
  return call('admin_withdraw_notice', { p_notice_id: noticeId, p_request_id: requestId });
}

// ------------------------------------------------------------------------------------ exports

export type ExportKind = 'shops' | 'clients' | 'bookings' | 'reviews' | 'subscriptions';
export const EXPORT_KINDS: readonly ExportKind[] = ['shops', 'clients', 'bookings', 'reviews', 'subscriptions'];

export interface BookingExportFilters {
  statuses?: BookingStatus[];
  shop_id?: string;
  client_id?: string;
  from?: string;
  to?: string;
  q?: string;
}

export interface ExportBookingRow {
  ref: string;
  status: BookingStatus;
  date: string;
  slot: string;
  created_at: string;
  shop_name: string;
  shop_city: string;
  client_display_id: string | null;
  client_name: string | null;
  client_phone: string | null;
  service_ro: string | null;
  service_en: string | null;
  make: string | null;
  model: string | null;
  year: string | null;
  plate: string | null;
  vin: string | null;
  odometer: number | null;
  cost: number | null;
  cancelled_by: string | null;
  reason: string | null;
}

export interface ExportReviewRow {
  created_at: string;
  shop_name: string;
  shop_city: string;
  ref: string | null;
  client_display_id: string | null;
  client_display_name: string;
  rating: number;
  text: string | null;
  reply: string | null;
  report_reason: ReportReason | null;
  reported_at: string | null;
  report_status: 'pending' | 'kept' | 'removed' | null;
  removed_at: string | null;
}

/**
 * The rows of one list for a CSV file (written to the audit log with the filters). Shops, clients
 * and subscriptions come whole — the screen applies its filters; bookings and reviews are filtered
 * in the database.
 */
export async function fetchExport(kind: ExportKind, filters: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
  return (await call('admin_export', { p_kind: kind, p_filters: filters as Json })) as unknown as Record<string, unknown>[];
}
