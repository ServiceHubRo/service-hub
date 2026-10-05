import type { BookingStatus } from './status';
import { ymdInBucharest } from '../i18n/format';

/**
 * The oil change (T30): each car in the Garage may carry how often its owner changes the oil and
 * when it was last changed. The mirror of `send_service_reminders` (migration
 * `oil_change_interval`): the newest of that date and the last finished oil change or full service
 * of the car, plus the client's months (else the catalog's for "Schimb ulei").
 */

/** The services that change the oil: the oil change itself and a full service (`oil_service_ids()`). */
export const OIL_SERVICE_IDS: readonly string[] = ['ulei', 'revizie'];

/** The intervals offered in the Garage, in months (the database takes 1–24). */
export const OIL_MONTH_CHOICES: readonly number[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 18, 24];

export interface OilJob {
  car_id: string | null;
  status: BookingStatus;
  service_id: string;
  extra_service_ids: readonly string[];
  done_at: string | null;
}

/** The day of the last oil change known for the car (Bucharest), or null. */
export function lastOilChange(car: { id: string; last_oil_change: string | null }, bookings: readonly OilJob[]): string | null {
  let last = car.last_oil_change;
  for (const b of bookings) {
    if (b.car_id !== car.id || b.status !== 'done' || !b.done_at) continue;
    if (![b.service_id, ...b.extra_service_ids].some((id) => OIL_SERVICE_IDS.includes(id))) continue;
    const day = ymdInBucharest(new Date(b.done_at));
    if (!last || day > last) last = day;
  }
  return last;
}

/** `YYYY-MM-DD` plus whole months, the end of a shorter month kept (31 Jan + 1 → 28/29 Feb), like Postgres. */
export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(Math.min(d, last))}`;
}

/** When the next oil change is due, or null when there is no date or no interval. */
export function oilDue(last: string | null, months: number | null): string | null {
  return last && months ? addMonths(last, months) : null;
}
