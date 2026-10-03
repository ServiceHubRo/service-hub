import type { FreePlace } from '../data/rpc';
import { useI18n } from '../i18n/context';
import { formatDate } from '../i18n/format';
import { relativeDay } from './freePlace';

/** "Liber azi, de la 9:00" / "Liber mâine…" / "Liber Mie 8 oct, de la 9:00" (T28a). */
export function useFreePlaceText(): (free: FreePlace) => string {
  const { t, lang } = useI18n();
  return (free) => {
    const rel = relativeDay(free.date);
    return rel === 'today'
      ? t('free.today', { time: free.slot })
      : rel === 'tomorrow'
        ? t('free.tomorrow', { time: free.slot })
        : t('free.date', { date: formatDate(lang, free.date), time: free.slot });
  };
}
