import type { AdminClientRow, AdminShopRow, AuditEntry, ShopState } from '../data/admin';
import { ymdInBucharest } from '../i18n/format';
import { BOOKING_STATUSES, isActiveStatus, type BookingStatus } from './status';
import { matchesWords, searchWords } from './text';

/**
 * The admin screens' own logic (T16a), without React: list filters, the age of a reported review
 * in working days, and what an audit entry changed.
 */

// ------------------------------------------------------------------------------------ shops

export type ShopFilter = 'all' | ShopState | 'unverified';
export const SHOP_FILTERS: readonly ShopFilter[] = ['all', 'active', 'trial', 'inactive', 'suspended', 'unverified', 'deleted'];

export function isShopFilter(value: string | null): value is ShopFilter {
  return value !== null && (SHOP_FILTERS as readonly string[]).includes(value);
}

/** Shops matching every word (name, city, account id, email, phone, owner) and the state chip. */
export function filterShops(rows: readonly AdminShopRow[], query: string, filter: ShopFilter): AdminShopRow[] {
  const words = searchWords(query);
  return rows.filter((r) => {
    if (filter === 'unverified') {
      if (r.state === 'deleted' || (r.email_verified && r.phone_verified)) return false;
    } else if (filter === 'all') {
      if (r.state === 'deleted') return false; // deleted shops only under their own chip
    } else if (r.state !== filter) {
      return false;
    }
    if (words.length === 0) return true;
    const phone = (r.phone ?? '').replace(/\D/g, '');
    return matchesWords(words, r.name, r.city, r.display_id, r.email ?? '', r.owner_name ?? '', r.phone ?? '', phone);
  });
}

// ------------------------------------------------------------------------------------ clients

/** No-shows in 90 days from which shops and admin see the flag (ARCHITECTURE §6). */
export const NO_SHOW_FLAG = 3;

export type ClientFilter = 'all' | 'suspended' | 'no_shows' | 'unverified';
export const CLIENT_FILTERS: readonly ClientFilter[] = ['all', 'suspended', 'no_shows', 'unverified'];

export function isClientFilter(value: string | null): value is ClientFilter {
  return value !== null && (CLIENT_FILTERS as readonly string[]).includes(value);
}

export function filterClients(rows: readonly AdminClientRow[], query: string, filter: ClientFilter): AdminClientRow[] {
  const words = searchWords(query);
  return rows.filter((r) => {
    if (filter === 'suspended' && !r.suspended) return false;
    if (filter === 'no_shows' && r.no_shows < NO_SHOW_FLAG) return false;
    if (filter === 'unverified' && r.email_verified) return false;
    if (words.length === 0) return true;
    const phone = (r.phone ?? '').replace(/\D/g, '');
    return matchesWords(words, r.name ?? '', r.display_id, r.email ?? '', r.phone ?? '', phone);
  });
}

// ------------------------------------------------------------------------------------ bookings

/** The status select of Rezervări: everything, the active ones, or one status. */
export type BookingStatusFilter = 'all' | 'active' | BookingStatus;
export const BOOKING_STATUS_FILTERS: readonly BookingStatusFilter[] = ['all', 'active', ...BOOKING_STATUSES];

export function isBookingStatusFilter(value: string | null): value is BookingStatusFilter {
  return value !== null && (BOOKING_STATUS_FILTERS as readonly string[]).includes(value);
}

/** The statuses to ask the database for; undefined = all. */
export function statusesFor(filter: BookingStatusFilter): BookingStatus[] | undefined {
  if (filter === 'all') return undefined;
  if (filter === 'active') return BOOKING_STATUSES.filter(isActiveStatus);
  return [filter];
}

export function isYmd(value: string | null): value is string {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

/** Pages of the bookings list: 100 more at a time, at most what the database hands out (500). */
export const BOOKINGS_PAGE = 100;
export const BOOKINGS_MAX = 500;

// ------------------------------------------------------------------------------------ moderation

/** The platform promises a decision on a reported review within 5 working days (P20). */
export const REPORT_DEADLINE_WORKING_DAYS = 5;

function dayNumber(ymd: string): number {
  return Math.round(Date.parse(`${ymd}T12:00:00Z`) / 86_400_000);
}

/** Monday–Friday days after `fromYmd`, up to and including `toYmd` (0 on the same day). */
export function workingDaysBetween(fromYmd: string, toYmd: string): number {
  const from = dayNumber(fromYmd);
  const to = dayNumber(toYmd);
  let n = 0;
  for (let d = from + 1; d <= to; d++) {
    // Noon is rounded up: day 1 is 1970-01-01, a Thursday.
    const weekday = (((d + 3) % 7) + 7) % 7; // 0 = Sunday
    if (weekday !== 0 && weekday !== 6) n++;
  }
  return n;
}

/** How long a report has waited: calendar days and working days (Bucharest), and whether it is late. */
export function reportAge(reportedAt: string, now: Date): { days: number; workingDays: number; overdue: boolean } {
  const from = ymdInBucharest(new Date(reportedAt));
  const to = ymdInBucharest(now);
  const workingDays = workingDaysBetween(from, to);
  return {
    days: Math.max(0, dayNumber(to) - dayNumber(from)),
    workingDays,
    overdue: workingDays >= REPORT_DEADLINE_WORKING_DAYS,
  };
}

// ------------------------------------------------------------------------------------ audit log

/** Actions with a label of their own (`admin.action.<action>`); others show their code. */
export const AUDIT_ACTIONS = [
  'promote_to_admin',
  'verify_phone',
  'verify_phone_manually',
  'suspend_shop',
  'unsuspend_shop',
  'suspend_account',
  'unsuspend_account',
  'auto_suspend_account',
  'auto_no_trial',
  'update_shop',
  'extend_trial',
  'set_subscription_status',
  'keep_review',
  'remove_review',
  'admin_force_cancel',
  'delete_account',
  // T16b
  'set_subscription_price',
  'void_report',
  'create_category',
  'update_category',
  'create_service',
  'update_service',
  'move_category',
  'move_service',
  'update_settings',
  'set_notification_text',
  'send_notice',
  'withdraw_notice',
  'export',
] as const;

export interface AuditChange {
  /** The field, `billing.iban` for the fiscal data. */
  key: string;
  before: unknown;
  after: unknown;
}

/** Keys that describe the action rather than a changed value: shown on their own line. */
const DETAIL_KEYS = new Set(['reason', 'note', 'days', 'mode', 'services_off', 'kind', 'filters', 'rows', 'recipients', 'push_recipients']);

/** Values kept whole (an export's filters): shown as one line, not split into their keys. */
const WHOLE_KEYS = new Set(['filters']);

function flatten(value: Record<string, unknown> | null | undefined, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && !WHOLE_KEYS.has(k)) {
      Object.assign(out, flatten(v as Record<string, unknown>, `${prefix}${k}.`));
    } else {
      out[`${prefix}${k}`] = v;
    }
  }
  return out;
}

/** What an entry changed (before → after), and its details (reason, note, days, how deleted). */
export function auditChanges(entry: Pick<AuditEntry, 'before' | 'after'>): { changes: AuditChange[]; details: AuditChange[] } {
  const before = flatten(entry.before);
  const after = flatten(entry.after);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changes: AuditChange[] = [];
  const details: AuditChange[] = [];
  for (const key of keys) {
    const item = { key, before: before[key], after: after[key] };
    if (DETAIL_KEYS.has(key)) details.push(item);
    else changes.push(item);
  }
  return { changes, details };
}
