import type { AdminClientRow, AdminShopRow, SubscriptionStatus } from '../data/admin';
import type {
  AdminReportRow,
  AdminSubscriptionRow,
  CatalogCategory,
  ExportBookingRow,
  ExportKind,
  ExportReviewRow,
  LimitKey,
  PlatformSettings,
  SettingKey,
  SettingsChange,
} from '../data/adminTools';
import { ymdInBucharest } from '../i18n/format';
import type { MessageKey } from '../i18n/ro';
import type { Lang, Params } from '../i18n/translate';
import { csvAmount, csvFormat } from './history';
import { fold, matchesWords, searchWords } from './text';

/**
 * The admin's platform tools (T16b) without React: list filters, new catalog ids, what a settings
 * form changed, the placeholders of a push text, and the CSV tables of the exports.
 */

type T = (key: MessageKey, params?: Params) => string;

// ------------------------------------------------------------------------------------ subscriptions

export type SubscriptionFilter = 'all' | SubscriptionStatus;
export const SUBSCRIPTION_FILTERS: readonly SubscriptionFilter[] = ['all', 'trial', 'active', 'past_due', 'cancelled', 'inactive'];

export function isSubscriptionFilter(value: string | null): value is SubscriptionFilter {
  return value !== null && (SUBSCRIPTION_FILTERS as readonly string[]).includes(value);
}

/** Subscriptions matching every word (shop, city, account id, email, Stripe ids) and the status chip. */
export function filterSubscriptions(
  rows: readonly AdminSubscriptionRow[],
  query: string,
  filter: SubscriptionFilter,
): AdminSubscriptionRow[] {
  const words = searchWords(query);
  return rows.filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (words.length === 0) return true;
    return matchesWords(
      words,
      r.shop_name,
      r.city,
      r.display_id,
      r.email ?? '',
      r.owner_name ?? '',
      r.stripe_customer_id ?? '',
      r.stripe_subscription_id ?? '',
    );
  });
}

// ------------------------------------------------------------------------------------ reports

export type ReportFilter = 'all' | 'generated' | 'paid' | 'void' | 'pending_payment';
export const REPORT_FILTERS: readonly ReportFilter[] = ['all', 'generated', 'paid', 'void', 'pending_payment'];

export function isReportFilter(value: string | null): value is ReportFilter {
  return value !== null && (REPORT_FILTERS as readonly string[]).includes(value);
}

/**
 * Reports matching every word (code, plate, car, client) and the chip. "Toate" leaves out the
 * checkouts never paid: they are only under their own chip.
 */
export function filterReports(rows: readonly AdminReportRow[], query: string, filter: ReportFilter): AdminReportRow[] {
  const words = searchWords(query);
  return rows.filter((r) => {
    if (filter === 'all' ? r.status === 'pending_payment' : r.status !== filter) return false;
    if (words.length === 0) return true;
    const plate = (r.car_snapshot.plate ?? '').replace(/[\s-]/g, '');
    return matchesWords(
      words,
      r.code,
      r.code.replace(/-/g, ''),
      r.car_snapshot.plate ?? '',
      plate,
      r.car_snapshot.make ?? '',
      r.car_snapshot.model ?? '',
      r.client_display_id ?? '',
      r.client_name ?? '',
    );
  });
}

// ------------------------------------------------------------------------------------ catalog

/** Simple lower-case words joined by `_`, no diacritics: `Polish faruri` → `polish_faruri`. */
function slug(name: string, max: number): string {
  return fold(name)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max)
    .replace(/_+$/, '');
}

/** The id suggested for a new service from its Romanian name (the admin may change it before saving). */
export function suggestServiceId(nameRo: string): string {
  const s = slug(nameRo, 40);
  return /^[a-z]/.test(s) ? s : s ? `s_${s}`.slice(0, 40) : '';
}

/** The key suggested for a new category: `cat_` + its name. */
export function suggestCategoryKey(nameRo: string): string {
  const s = slug(nameRo, 30);
  return s ? `cat_${s}` : '';
}

export const SERVICE_ID_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
export const CATEGORY_KEY_PATTERN = /^cat_[a-z0-9_]{2,30}$/;

/** The service reminder interval typed in the catalog (T19d): empty = none, else 1–120 whole months. */
export function parseIntervalMonths(text: string): number | null | 'invalid' {
  const s = text.trim();
  if (s === '') return null;
  if (!/^\d{1,3}$/.test(s)) return 'invalid';
  const n = Number(s);
  return n >= 1 && n <= 120 ? n : 'invalid';
}

/**
 * The catalog narrowed to the services whose name (RO/EN) or id matches every word; a category
 * whose own name matches keeps all its services. Without a search, everything.
 */
export function filterCatalog(categories: readonly CatalogCategory[], query: string): CatalogCategory[] {
  const words = searchWords(query);
  if (words.length === 0) return [...categories];
  const out: CatalogCategory[] = [];
  for (const c of categories) {
    if (matchesWords(words, c.name_ro, c.name_en, c.key)) {
      out.push(c);
      continue;
    }
    const services = c.services.filter((s) => matchesWords(words, s.name_ro, s.name_en, s.id));
    if (services.length > 0) out.push({ ...c, services });
  }
  return out;
}

// ------------------------------------------------------------------------------------ settings

/** The form's fields, by section, in the order shown. */
export const SETTING_SECTIONS: readonly { key: string; fields: readonly SettingKey[] }[] = [
  {
    key: 'prices',
    fields: [
      'subscription_price_ron',
      'launch_price_ron',
      'launch_shops',
      'staff_seat_price_ron',
      'staff_free_seats',
      'report_price_ron',
      'vat_rate_percent',
    ],
  },
  { key: 'periods', fields: ['trial_days', 'quote_expiry_days'] },
  { key: 'ranking', fields: ['ranking_prior_avg', 'ranking_prior_weight'] },
  {
    key: 'defaults',
    fields: [
      'default_daily_capacity',
      'default_cars_per_slot',
      'default_slot_minutes',
      'default_min_notice_hours',
      'default_max_advance_days',
      'default_cancel_deadline_hours',
    ],
  },
];

/** Values with decimals (the rest are whole numbers). */
export const DECIMAL_SETTINGS: ReadonlySet<SettingKey> = new Set([
  'subscription_price_ron',
  'staff_seat_price_ron',
  'launch_price_ron',
  'report_price_ron',
  'vat_rate_percent',
  'ranking_prior_avg',
  'ranking_prior_weight',
]);

export type SettingsDraft = Record<SettingKey | LimitKey, string>;

/** A number typed in either language: `29,50` or `29.50`; null when it is not one. */
export function parseNumber(text: string): number | null {
  const s = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/**
 * What the form changed, ready for admin_update_settings — only the values that differ; `invalid`
 * lists the fields that are not numbers (or not whole where they must be).
 */
export function settingsChange(
  current: PlatformSettings,
  draft: Partial<SettingsDraft>,
): { change: SettingsChange; invalid: string[] } {
  const change: SettingsChange = {};
  const invalid: string[] = [];
  const limits: Partial<Record<LimitKey, number>> = {};
  for (const [key, text] of Object.entries(draft) as [SettingKey | LimitKey, string][]) {
    const n = parseNumber(text);
    const isLimit = key in current.limits;
    const whole = isLimit || !DECIMAL_SETTINGS.has(key as SettingKey);
    if (n === null || (whole && !Number.isInteger(n))) {
      invalid.push(key);
      continue;
    }
    if (isLimit) {
      if (current.limits[key as LimitKey] !== n) limits[key as LimitKey] = n;
    } else if (Number(current[key as SettingKey]) !== n) {
      change[key as SettingKey] = n;
    }
  }
  if (Object.keys(limits).length > 0) change.limits = limits;
  return { change, invalid };
}

// ------------------------------------------------------------------------------------ push texts

/** The `{name}` placeholders a text uses, in order, without repeats. */
export function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))];
}

/** Placeholders a new text uses that the built-in text of the same key never fills. */
export function unknownPlaceholders(text: string, allowed: readonly string[]): string[] {
  return placeholdersOf(text).filter((p) => !allowed.includes(p));
}

// ------------------------------------------------------------------------------------ CSV

/** A moment as `2026-10-14 10:32` in Bucharest (spreadsheets sort it). */
export function csvDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bucharest',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
  return `${ymdInBucharest(d)} ${time}`;
}

const yesNo = (t: T, v: boolean) => t(v ? 'admin.yes' : 'admin.no');

type Column<R> = [MessageKey, (r: R, t: T, lang: Lang, decimal: string) => string];

const SHOP_COLUMNS: Column<AdminShopRow & Record<string, unknown>>[] = [
  ['admin.csv.account', (r) => r.display_id],
  ['admin.csv.shop', (r) => r.name],
  ['admin.csv.city', (r) => r.city],
  ['admin.csv.street', (r) => String(r.street ?? '')],
  ['admin.csv.county', (r) => String(r.county ?? '')],
  ['admin.csv.owner', (r) => r.owner_name ?? ''],
  ['admin.csv.email', (r) => r.email ?? ''],
  ['admin.csv.phone', (r) => r.phone ?? ''],
  ['admin.csv.emailVerified', (r, t) => yesNo(t, r.email_verified)],
  ['admin.csv.phoneVerified', (r, t) => yesNo(t, r.phone_verified)],
  ['admin.csv.state', (r, t) => t(`admin.shopState.${r.state}`)],
  ['admin.csv.inSearch', (r, t) => yesNo(t, r.public)],
  ['admin.csv.subscription', (r, t) => (r.subscription_status ? t(`admin.subStatus.${r.subscription_status}`) : '')],
  ['admin.csv.price', (r, _t, _l, d) => csvAmount(r.price_ron === null || r.price_ron === undefined ? null : Number(r.price_ron), d)],
  ['admin.csv.trialEnds', (r) => csvDateTime(r.trial_ends_at)],
  ['admin.csv.rating', (r, _t, _l, d) => (r.rating === null || r.rating === undefined ? '' : String(r.rating).replace('.', d))],
  ['admin.csv.reviews', (r) => String(r.review_count ?? 0)],
  ['admin.csv.bookings', (r) => String(r.bookings ?? 0)],
  ['admin.csv.created', (r) => csvDateTime(r.created_at)],
  ['admin.csv.lastActive', (r) => csvDateTime(r.last_active_at)],
];

const CLIENT_COLUMNS: Column<AdminClientRow & Record<string, unknown>>[] = [
  ['admin.csv.account', (r) => r.display_id],
  ['admin.csv.name', (r) => r.name ?? ''],
  ['admin.csv.email', (r) => r.email ?? ''],
  ['admin.csv.phone', (r) => r.phone ?? ''],
  ['admin.csv.emailVerified', (r, t) => yesNo(t, r.email_verified)],
  ['admin.csv.suspended', (r, t) => yesNo(t, r.suspended)],
  ['admin.csv.language', (r) => String(r.lang ?? '')],
  ['admin.csv.cars', (r) => String(r.cars ?? 0)],
  ['admin.csv.bookings', (r) => String(r.bookings)],
  ['admin.csv.activeBookings', (r) => String(r.active_bookings)],
  ['admin.csv.noShows', (r) => String(r.no_shows)],
  ['admin.csv.created', (r) => csvDateTime(r.created_at)],
  ['admin.csv.lastActive', (r) => csvDateTime(r.last_active_at)],
];

const BOOKING_COLUMNS: Column<ExportBookingRow>[] = [
  ['admin.csv.ref', (r) => r.ref],
  ['admin.csv.status', (r, t) => t(`status.${r.status}`)],
  ['admin.csv.date', (r) => r.date],
  ['admin.csv.time', (r) => r.slot],
  ['admin.csv.shop', (r) => r.shop_name],
  ['admin.csv.city', (r) => r.shop_city],
  ['admin.csv.account', (r) => r.client_display_id ?? ''],
  ['admin.csv.client', (r) => r.client_name ?? ''],
  ['admin.csv.phone', (r) => r.client_phone ?? ''],
  ['admin.csv.service', (r, _t, lang) => (lang === 'en' ? r.service_en : r.service_ro) ?? ''],
  ['admin.csv.car', (r) => [r.make, r.model, r.year].filter(Boolean).join(' ')],
  ['admin.csv.plate', (r) => r.plate ?? ''],
  ['admin.csv.vin', (r) => r.vin ?? ''],
  ['admin.csv.odometer', (r) => (r.odometer === null ? '' : String(r.odometer))],
  ['admin.csv.amount', (r, _t, _l, d) => csvAmount(r.cost === null ? null : Number(r.cost), d)],
  ['admin.csv.cancelledBy', (r, t) => (r.cancelled_by ? t(`admin.csv.by.${r.cancelled_by}` as MessageKey) : '')],
  ['admin.csv.reason', (r) => r.reason ?? ''],
  ['admin.csv.created', (r) => csvDateTime(r.created_at)],
];

const REVIEW_COLUMNS: Column<ExportReviewRow>[] = [
  ['admin.csv.created', (r) => csvDateTime(r.created_at)],
  ['admin.csv.shop', (r) => r.shop_name],
  ['admin.csv.city', (r) => r.shop_city],
  ['admin.csv.ref', (r) => r.ref ?? ''],
  ['admin.csv.account', (r) => r.client_display_id ?? ''],
  ['admin.csv.client', (r) => r.client_display_name],
  ['admin.csv.stars', (r) => String(r.rating)],
  ['admin.csv.text', (r) => r.text ?? ''],
  ['admin.csv.reply', (r) => r.reply ?? ''],
  ['admin.csv.reportReason', (r, t) => (r.report_reason ? t(`reviews.reason.${r.report_reason}`) : '')],
  ['admin.csv.reportedAt', (r) => csvDateTime(r.reported_at)],
  ['admin.csv.reportStatus', (r, t) => (r.report_status ? t(`admin.reportStatus.${r.report_status}`) : '')],
  ['admin.csv.removedAt', (r) => csvDateTime(r.removed_at)],
];

const SUBSCRIPTION_COLUMNS: Column<AdminSubscriptionRow>[] = [
  ['admin.csv.account', (r) => r.display_id],
  ['admin.csv.shop', (r) => r.shop_name],
  ['admin.csv.city', (r) => r.city],
  ['admin.csv.email', (r) => r.email ?? ''],
  ['admin.csv.status', (r, t) => t(`admin.subStatus.${r.status}`)],
  ['admin.csv.stripeStatus', (r) => r.stripe_status ?? ''],
  ['admin.csv.price', (r, _t, _l, d) => csvAmount(Number(r.price_ron), d)],
  ['admin.csv.seats', (r) => String(r.seats ?? 0)],
  ['admin.csv.seatPrice', (r, _t, _l, d) => csvAmount(Number(r.seat_price_ron), d)],
  ['admin.csv.monthly', (r, _t, _l, d) => csvAmount(Number(r.monthly_ron), d)],
  ['admin.csv.nextBilling', (r) => csvDateTime(r.next_billing)],
  ['admin.csv.trialEnds', (r) => csvDateTime(r.trial_ends_at)],
  ['admin.csv.periodEnd', (r) => csvDateTime(r.current_period_end)],
  ['admin.csv.cancelAtEnd', (r, t) => yesNo(t, Boolean(r.cancel_at_period_end))],
  ['admin.csv.paymentFailed', (r) => csvDateTime(r.payment_failed_at)],
  ['admin.csv.paidCount', (r) => String(r.paid_count)],
  ['admin.csv.paidTotal', (r, _t, _l, d) => csvAmount(Number(r.paid_total), d)],
  ['admin.csv.stripeCustomer', (r) => r.stripe_customer_id ?? ''],
  ['admin.csv.stripeSubscription', (r) => r.stripe_subscription_id ?? ''],
];

const COLUMNS: Record<ExportKind, Column<never>[]> = {
  shops: SHOP_COLUMNS as Column<never>[],
  clients: CLIENT_COLUMNS as Column<never>[],
  bookings: BOOKING_COLUMNS as Column<never>[],
  reviews: REVIEW_COLUMNS as Column<never>[],
  subscriptions: SUBSCRIPTION_COLUMNS as Column<never>[],
};

/** The rows of an export as a table (header first), in the interface language. */
export function exportTable(kind: ExportKind, rows: readonly unknown[], t: T, lang: Lang): string[][] {
  const { decimal } = csvFormat(lang);
  const columns = COLUMNS[kind] as Column<unknown>[];
  return [columns.map(([label]) => t(label)), ...rows.map((r) => columns.map(([, value]) => value(r, t, lang, decimal)))];
}

/** `service-uri-2026-10-14.csv` / `shops-2026-10-14.csv`. */
export function exportFileName(kind: ExportKind, t: T, today: string): string {
  return `${t(`admin.export.file.${kind}`)}-${today}.csv`;
}
