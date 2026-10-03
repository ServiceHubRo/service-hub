import { ymdInBucharest } from '../i18n/format';
import { addDays } from './shopBookings';

/** The day filter of the search (T28a): `azi`, `maine` or a `YYYY-MM-DD` from today on. */
export type DayFilter = 'azi' | 'maine' | string;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day a `zi` parameter asks for, in Europe/Bucharest; null for none or a past day. */
export function resolveDay(param: string | null, now: Date = new Date()): string | null {
  const today = ymdInBucharest(now);
  if (param === 'azi') return today;
  if (param === 'maine') return addDays(today, 1);
  if (param && YMD.test(param) && !Number.isNaN(Date.parse(`${param}T12:00:00Z`)) && param >= today) return param;
  return null;
}

/** How a free place reads next to today: 0 today, 1 tomorrow, else the date. */
export function relativeDay(ymd: string, now: Date = new Date()): 'today' | 'tomorrow' | 'date' {
  const today = ymdInBucharest(now);
  if (ymd === today) return 'today';
  if (ymd === addDays(today, 1)) return 'tomorrow';
  return 'date';
}
