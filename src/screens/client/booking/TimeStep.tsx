import { useCallback } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { LoadError } from '../../../components/LoadError';
import { SkeletonGrid } from '../../../components/Skeleton';
import { getAvailability } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { useLoad } from '../../../lib/useLoad';
import styles from './booking.module.css';

/**
 * Step 3: the day's times on the shop's grid (30 or 60 min). Taken times are struck through and
 * cannot be chosen; times that have passed, or are closer than the shop's notice, are not shown.
 */
export function TimeStep({
  shopId,
  day,
  selected,
  onPick,
  onPickDay,
}: {
  shopId: string;
  day: string;
  selected: string | null;
  onPick: (time: string) => void;
  onPickDay: () => void;
}) {
  const { t } = useI18n();
  const load = useCallback(() => getAvailability(shopId, { from: day, days: 1, slotsFor: day }), [shopId, day]);
  const { state, reload } = useLoad(load);

  if (state.status === 'loading') return <SkeletonGrid count={9} className={styles.grid} />;
  if (state.status === 'error') return <LoadError message={t('booking.times.loadError')} onRetry={reload} />;

  const slots = state.data.slots.filter((s) => s.available || s.reason === 'full');
  if (!slots.some((s) => s.available)) {
    return (
      <Banner tone="warning" action={<Button onClick={onPickDay}>{t('booking.times.pickDay')}</Button>}>
        {t('booking.times.none')}
      </Banner>
    );
  }

  return (
    <>
      <ul className={styles.grid}>
        {slots.map((s) => {
          const on = s.time === selected && s.available;
          return (
            <li key={s.time}>
              <button
                type="button"
                className={`${styles.time} ${on ? styles.tileOn : ''} ${s.available ? '' : styles.taken}`}
                disabled={!s.available}
                aria-pressed={on}
                onClick={() => onPick(s.time)}
              >
                <span className="mono">{s.time}</span>
                {!s.available && <span className="visually-hidden">, {t('booking.times.taken')}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {slots.some((s) => !s.available) && <p className={styles.muted}>{t('booking.times.takenNote')}</p>}
    </>
  );
}
