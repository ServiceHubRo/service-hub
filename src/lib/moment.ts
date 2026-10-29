import { formatDate, formatTime } from '../i18n/format';
import type { Lang } from '../i18n/translate';

/** `Mar 14 oct, 09:15` / `Tue, Oct 14, 09:15`, in Bucharest. */
export function momentText(lang: Lang, iso: string): string {
  const d = new Date(iso);
  return `${formatDate(lang, d)}, ${formatTime(lang, d)}`;
}
