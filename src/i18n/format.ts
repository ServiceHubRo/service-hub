import { plural, translate, type Lang } from './translate';

// Every date and time is shown in Romanian local time, whatever the device zone.
export const TIME_ZONE = 'Europe/Bucharest';

const locales: Record<Lang, string> = { ro: 'ro-RO', en: 'en-US' };

function groupedInteger(lang: Lang, value: number): string {
  return new Intl.NumberFormat(locales[lang], {
    maximumFractionDigits: 0,
    useGrouping: 'always',
  }).format(value);
}

/** RO `1.250 lei`, EN `1,250 RON`. Decimals only when the amount has them. */
export function formatMoney(lang: Lang, amount: number): string {
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  const n = new Intl.NumberFormat(locales[lang], {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
    useGrouping: 'always',
  }).format(amount);
  return lang === 'ro' ? `${n} lei` : `${n} RON`;
}

/** RO `105.400 km`, EN `105,400 km`. */
export function formatKm(lang: Lang, km: number): string {
  return `${groupedInteger(lang, km)} km`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parts(lang: Lang, date: Date, options: Intl.DateTimeFormatOptions) {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat(locales[lang], { ...options, timeZone: TIME_ZONE }).formatToParts(date)) {
    out[p.type] = p.value.replace(/\.$/, '');
  }
  return out;
}

/** RO `Mar 14 oct`, EN `Tue, Oct 14`. Accepts a Date or a `YYYY-MM-DD` booking date. */
export function formatDate(lang: Lang, value: Date | string): string {
  const date = typeof value === 'string' ? dateFromYmd(value) : value;
  const p = parts(lang, date, { weekday: 'short', day: 'numeric', month: 'short' });
  return lang === 'ro'
    ? `${capitalize(p.weekday ?? '')} ${p.day} ${p.month}`
    : `${p.weekday}, ${p.month} ${p.day}`;
}

/** 24-hour `09:00` in Europe/Bucharest. */
export function formatTime(lang: Lang, date: Date): string {
  const p = parts(lang, date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.hour}:${p.minute}`;
}

/** Calendar day `YYYY-MM-DD` of an instant, in Europe/Bucharest. */
export function ymdInBucharest(date: Date): string {
  const p = parts('en', date, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** A booking date is a calendar day; noon UTC keeps it on the same day in Bucharest. */
function dateFromYmd(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`);
}

function dayNumber(ymd: string): number {
  return Math.round(dateFromYmd(ymd).getTime() / 86_400_000);
}

/** "azi", "mâine", "în 12 zile", "acum 3 zile" — counted in Bucharest calendar days. */
export function formatRelativeDays(lang: Lang, target: Date | string, now: Date = new Date()): string {
  const targetYmd = typeof target === 'string' ? target : ymdInBucharest(target);
  const diff = dayNumber(targetYmd) - dayNumber(ymdInBucharest(now));
  if (diff === 0) return translate(lang, 'rel.today');
  if (diff === 1) return translate(lang, 'rel.tomorrow');
  if (diff === -1) return translate(lang, 'rel.yesterday');
  const days = plural(lang, 'unit.days', Math.abs(diff));
  return diff > 0 ? translate(lang, 'rel.inDays', { days }) : translate(lang, 'rel.daysAgo', { days });
}
