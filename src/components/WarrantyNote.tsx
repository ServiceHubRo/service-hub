import { ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n/context';
import { formatDayMonth, ymdInBucharest } from '../i18n/format';
import { plural } from '../i18n/translate';
import styles from './WarrantyNote.module.css';

/**
 * The warranty the shop gave on a finished job (T37a): "Garanție 12 luni, până la 27 sept 2027",
 * and once it is over, "Garanția s-a încheiat pe …" (muted). Nothing without a warranty.
 */
export function WarrantyNote({ months, until }: { months: number | null | undefined; until: string | null | undefined }) {
  const { t, lang } = useI18n();
  if (!months || !until) return null;
  const ended = until < ymdInBucharest(new Date());
  return (
    // A span, so it also fits inside a card's button (the car's history, Istoric).
    <span className={`${styles.note} ${ended ? styles.ended : ''}`}>
      <ShieldCheck size={16} aria-hidden="true" className={styles.icon} />
      <span>
        {ended
          ? t('warranty.ended', { date: formatDayMonth(lang, until) })
          : t('warranty.until', { months: plural(lang, 'unit.months', months), date: formatDayMonth(lang, until) })}
      </span>
    </span>
  );
}
