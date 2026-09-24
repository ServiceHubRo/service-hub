import { CalendarX } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Banner } from '../../../components/Banner';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SkeletonGrid } from '../../../components/Skeleton';
import { getAvailability } from '../../../data/rpc';
import type { ShopPageShop } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { formatDate, formatDayTile } from '../../../i18n/format';
import { plural } from '../../../i18n/translate';
import { BOOKING_DAYS_SHOWN, bookingDays } from '../../../lib/bookingDays';
import { useLoad } from '../../../lib/useLoad';
import styles from './booking.module.css';

/**
 * Step 2: the next 12 days the shop is open, with the places left; full days dimmed and not
 * selectable. The database counts the places (get_availability) — the screen never does.
 */
export function DayStep({
  shop,
  selected,
  notice,
  onPick,
}: {
  shop: ShopPageShop;
  selected: string | null;
  /** Shown above the days when the client was sent back here (the time went meanwhile). */
  notice: string | null;
  onPick: (day: string) => void;
}) {
  const { t, lang } = useI18n();
  // Every day up to the shop's horizon, so 12 open days are found even after closed weeks.
  const load = useCallback(
    () => getAvailability(shop.id, { days: Math.min(shop.max_advance_days + 1, 366) }),
    [shop.id, shop.max_advance_days],
  );
  const { state, reload } = useLoad(load);
  const days = useMemo(
    () => (state.status === 'ready' ? bookingDays(state.data.days, shop.min_notice_hours) : []),
    [state, shop.min_notice_hours],
  );

  return (
    <>
      {notice && <Banner tone="warning">{notice}</Banner>}
      {state.status === 'loading' && <SkeletonGrid count={BOOKING_DAYS_SHOWN} className={styles.grid} />}
      {state.status === 'error' && <LoadError message={t('booking.days.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (days.length === 0 ? (
          <EmptyState icon={CalendarX} title={t('booking.days.empty')} body={t('booking.days.emptyBody')} />
        ) : (
          <>
            <ul className={styles.grid}>
              {days.map((d) => {
                const tile = formatDayTile(lang, d.date);
                const on = d.date === selected;
                const places = d.bookable ? plural(lang, 'unit.places', d.places_left) : t('booking.day.full');
                return (
                  <li key={d.date}>
                    <button
                      type="button"
                      className={`${styles.tile} ${on ? styles.tileOn : ''}`}
                      disabled={!d.bookable}
                      aria-pressed={on}
                      aria-label={t('booking.day.label', { date: formatDate(lang, d.date), places })}
                      onClick={() => onPick(d.date)}
                    >
                      <span className={styles.tileSmall}>{tile.weekday}</span>
                      <span className={styles.tileBig}>{tile.day}</span>
                      <span className={styles.tileSmall}>{tile.month}</span>
                      <span className={d.bookable ? styles.places : styles.full}>{places}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className={styles.muted}>{t('booking.days.horizon', { days: plural(lang, 'unit.days', shop.max_advance_days) })}</p>
          </>
        ))}
    </>
  );
}
