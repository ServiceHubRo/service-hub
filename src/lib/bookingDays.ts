import type { AvailabilityDay } from '../data/rpc';
import { ymdInBucharest } from '../i18n/format';

/** How many open days the booking calendar offers (ARCHITECTURE §4). */
export const BOOKING_DAYS_SHOWN = 12;

/**
 * The day tiles of the booking calendar, from get_availability's answer: the next 12 days the shop
 * is open, full ones included (shown dimmed). Closed days, closures and days past the shop's
 * booking horizon never appear. A day with no time left because of the clock — today after the
 * last slot, or a day still inside the shop's minimum notice — does not appear either; a later
 * day with no time left means every time is taken, so it shows as full.
 */
export function bookingDays(
  days: readonly AvailabilityDay[],
  minNoticeHours: number,
  now: Date = new Date(),
  count: number = BOOKING_DAYS_SHOWN,
): AvailabilityDay[] {
  const noticeEnds = ymdInBucharest(new Date(now.getTime() + Math.max(0, minNoticeHours) * 3_600_000));
  const today = ymdInBucharest(now);
  return days
    .filter((d) => d.date >= today)
    .filter((d) => d.reason === null || d.reason === 'full' || (d.reason === 'no_slots' && d.date > noticeEnds))
    .slice(0, count);
}
