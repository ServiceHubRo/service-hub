import { formatTime, ymdInBucharest } from '../i18n/format';
import type { BookingStatus } from './status';

/**
 * The shop's Panou and Programări (FR §4.1, §4.2): which tab a booking belongs to, the Panou
 * counters and filters. Pure logic on the list `list_shop_bookings` returns (active bookings only);
 * dates and times are Europe/Bucharest.
 */

/** Cereri = requests waiting for an answer; Programate = confirmed until done. */
export type ShopTab = 'cereri' | 'programate';

/** The Panou cards that open a filtered Programate list (P8c). */
export type ShopFilter = 'azi' | '7zile' | 'constatare' | 'deviz' | 'lucru';

export const SHOP_FILTERS: readonly ShopFilter[] = ['azi', '7zile', 'constatare', 'deviz', 'lucru'];

const FILTER_STATUS: Partial<Record<ShopFilter, BookingStatus>> = {
  constatare: 'in_inspection',
  deviz: 'quote_sent',
  lucru: 'in_progress',
};

export interface BookingWhen {
  status: BookingStatus;
  date: string; // YYYY-MM-DD
  slot: string; // HH:MM
}

export function tabOf(status: BookingStatus): ShopTab {
  return status === 'pending' ? 'cereri' : 'programate';
}

/** `YYYY-MM-DD` plus n calendar days. */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Now" as a comparable `YYYY-MM-DD HH:MM` in Bucharest. */
export function nowKey(now: Date = new Date()): string {
  return `${ymdInBucharest(now)} ${formatTime('en', now)}`;
}

/** Whether the booking's day and time have started (no-show becomes possible). */
export function slotStarted(b: Pick<BookingWhen, 'date' | 'slot'>, now: Date = new Date()): boolean {
  return `${b.date} ${b.slot.slice(0, 5)}` <= nowKey(now);
}

export function matchesFilter(b: BookingWhen, filter: ShopFilter, today: string): boolean {
  if (tabOf(b.status) !== 'programate') return false;
  if (filter === 'azi') return b.date === today;
  // "7 zile": today and the six days after it.
  if (filter === '7zile') return b.date >= today && b.date <= addDays(today, 6);
  return b.status === FILTER_STATUS[filter];
}

export interface DashboardCounts {
  /** Cereri noi: requests waiting for an answer. */
  requests: number;
  /** Azi: scheduled bookings (confirmed onward) dated today. */
  today: number;
  /** 7 zile: scheduled bookings from today through the next six days. */
  week: number;
  inspection: number;
  quote: number;
  work: number;
  /** Every active booking dated today, requests included (capacity line). */
  todayTaken: number;
}

export function dashboardCounts(bookings: readonly BookingWhen[], today: string): DashboardCounts {
  const count = (filter: ShopFilter) => bookings.filter((b) => matchesFilter(b, filter, today)).length;
  return {
    requests: bookings.filter((b) => b.status === 'pending').length,
    today: count('azi'),
    week: count('7zile'),
    inspection: count('constatare'),
    quote: count('deviz'),
    work: count('lucru'),
    todayTaken: bookings.filter((b) => b.date === today).length,
  };
}

/** Programul de azi: today's scheduled bookings by time. */
export function todaySchedule<T extends BookingWhen>(bookings: readonly T[], today: string): T[] {
  return bookings.filter((b) => matchesFilter(b, 'azi', today)).sort((a, b) => a.slot.localeCompare(b.slot));
}

/** A tab's list, soonest first (an overdue booking stays on top until the shop acts on it). */
export function tabList<T extends BookingWhen>(bookings: readonly T[], tab: ShopTab): T[] {
  return bookings
    .filter((b) => tabOf(b.status) === tab)
    .sort((a, b) => `${a.date} ${a.slot}`.localeCompare(`${b.date} ${b.slot}`));
}

export function parseTab(value: string | null): ShopTab {
  return value === 'programate' ? 'programate' : 'cereri';
}

export function parseFilter(value: string | null): ShopFilter | null {
  return SHOP_FILTERS.includes(value as ShopFilter) ? (value as ShopFilter) : null;
}
