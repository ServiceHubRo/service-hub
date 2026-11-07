import type { SupportCategory } from '../../data/supportRequests';
import { formatDayMonth, formatTime } from '../../i18n/format';
import type { Lang } from '../../i18n/translate';

/** A category's name in the interface's language (its key while the categories load). */
export function categoryName(categories: SupportCategory[] | null, key: string, lang: Lang): string {
  const c = categories?.find((x) => x.key === key);
  return c ? (lang === 'en' ? c.name_en : c.name_ro) : key;
}

/** `14 oct, 10:32` in Bucharest. */
export function whenText(lang: Lang, iso: string): string {
  const d = new Date(iso);
  return `${formatDayMonth(lang, d)}, ${formatTime(lang, d)}`;
}

/** `14 oct` of a `YYYY-MM-DD` day. */
export function dayText(lang: Lang, ymd: string): string {
  return formatDayMonth(lang, ymd);
}
