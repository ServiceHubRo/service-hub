import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/ro';
import type { DayHours, HoursRow } from '../lib/hours';
import { groupHours } from '../lib/hours';
import styles from './HoursTable.module.css';

const dayName = (t: (k: MessageKey) => string, d: number) => t(`weekday.short.${d}` as MessageKey);

/**
 * A shop's week as a small table, the same on every screen (Eduard, 19 Nov 2026: „simetric pe toate
 * ecranele, nu descentrat”): the days in one column, the hours in another, every hour starting at the
 * same edge, „Închis” under them. Days with the same hours share a row („Lun – Vin”).
 */
export function HoursTable({ hours, className = '' }: { hours: DayHours[]; className?: string }) {
  const { t } = useI18n();
  const rows: HoursRow[] = groupHours(hours);
  return (
    <ul data-ui="hours" className={`${styles.table} ${className}`}>
      {rows.map((r) => (
        <li key={r.days.join('-')} className={styles.row}>
          <span className={styles.days}>
            {r.days.length === 1 ? dayName(t, r.days[0]!) : `${dayName(t, r.days[0]!)} – ${dayName(t, r.days[r.days.length - 1]!)}`}
          </span>
          <span className={r.closed ? styles.closed : `mono ${styles.time}`}>{r.closed ? t('shop.closed') : `${r.open} – ${r.close}`}</span>
        </li>
      ))}
    </ul>
  );
}
