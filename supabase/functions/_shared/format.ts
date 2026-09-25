// Money, dates and times for server-written texts (notifications), in Europe/Bucharest.
// The same rules as src/i18n/format.ts in the app (a unit test compares them).

export type Lang = 'ro' | 'en';

const TIME_ZONE = 'Europe/Bucharest';
const locales: Record<Lang, string> = { ro: 'ro-RO', en: 'en-US' };

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
  const n = new Intl.NumberFormat(locales[lang], { maximumFractionDigits: 0, useGrouping: 'always' }).format(km);
  return `${n} km`;
}

function parts(lang: Lang, date: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat(locales[lang], { ...options, timeZone: TIME_ZONE }).formatToParts(date)) {
    out[p.type] = p.value.replace(/\.$/, '');
  }
  return out;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A booking date is a calendar day; noon UTC keeps it on the same day in Bucharest. */
const dateFromYmd = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

/** RO `Mar 14 oct`, EN `Tue, Oct 14`. */
export function formatDate(lang: Lang, value: Date | string): string {
  const date = typeof value === 'string' ? dateFromYmd(value) : value;
  const p = parts(lang, date, { weekday: 'short', day: 'numeric', month: 'short' });
  return lang === 'ro' ? `${capitalize(p.weekday ?? '')} ${p.day} ${p.month}` : `${p.weekday}, ${p.month} ${p.day}`;
}

/** RO `14 oct`, EN `Oct 14`. */
export function formatDayMonth(lang: Lang, value: Date | string): string {
  const date = typeof value === 'string' ? dateFromYmd(value) : value;
  const p = parts(lang, date, { day: 'numeric', month: 'short' });
  return lang === 'ro' ? `${p.day} ${p.month}` : `${p.month} ${p.day}`;
}

/** RO `oct 2025`, EN `Oct 2025`. */
export function formatMonthYear(lang: Lang, value: Date | string): string {
  const date = typeof value === 'string' ? dateFromYmd(value) : value;
  const p = parts(lang, date, { month: 'short', year: 'numeric' });
  return `${p.month} ${p.year}`;
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

/** Calendar days from `from` to `ymd` (Bucharest): 0 same day, 1 the next day. */
export function daysBetween(ymd: string, from: Date): number {
  const day = (s: string) => Math.round(dateFromYmd(s).getTime() / 86_400_000);
  return day(ymd) - day(ymdInBucharest(from));
}
