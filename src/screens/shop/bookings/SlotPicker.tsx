import { useCallback, useMemo, useState } from 'react';
import { Button } from '../../../components/Button';
import { LoadError } from '../../../components/LoadError';
import { SkeletonGrid } from '../../../components/Skeleton';
import { getAvailability } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { formatDate, formatDayTile } from '../../../i18n/format';
import { plural } from '../../../i18n/translate';
import { bookingDays } from '../../../lib/bookingDays';
import { useLoad } from '../../../lib/useLoad';
import styles from './shopBookings.module.css';

/** How far ahead the shop can place a booking, and how many open days show at once. */
const HORIZON_DAYS = 92;
const DAYS_STEP = 12;

/**
 * The shop's own calendar (Reprogramează, Adaugă programare): no minimum notice, days and times
 * already past never offered. Full days are dimmed and taken times struck through. With
 * `excludeBooking`, the place that booking holds now counts as free and its time is marked. To read
 * the days again (the database refused a stale pick), the caller gives it a new `key`.
 */
export function SlotPicker({
  shopId,
  excludeBooking,
  current,
  day,
  time,
  onDay,
  onTime,
  dayLabel,
}: {
  shopId: string;
  excludeBooking?: string;
  current?: { date: string; slot: string };
  day: string | null;
  time: string | null;
  onDay: (date: string) => void;
  onTime: (time: string) => void;
  dayLabel: string;
}) {
  const { t, lang } = useI18n();
  const load = useCallback(() => getAvailability(shopId, { days: HORIZON_DAYS, excludeBooking }), [shopId, excludeBooking]);
  const { state, reload } = useLoad(load);
  const [shown, setShown] = useState(DAYS_STEP);

  const allDays = useMemo(
    () => (state.status === 'ready' ? bookingDays(state.data.days, 0, new Date(), HORIZON_DAYS) : []),
    [state],
  );
  const days = allDays.slice(0, shown);

  return (
    <>
      <p className={styles.stepLabel}>{dayLabel}</p>
      {state.status === 'loading' && <SkeletonGrid count={DAYS_STEP} className={styles.grid} />}
      {state.status === 'error' && <LoadError message={t('booking.days.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (allDays.length === 0 ? (
          <p className={styles.muted}>{t('sb.reschedule.noDays')}</p>
        ) : (
          <>
            <ul className={styles.grid}>
              {days.map((d) => {
                const tile = formatDayTile(lang, d.date);
                const on = d.date === day;
                const places = d.bookable ? plural(lang, 'unit.places', d.places_left) : t('booking.day.full');
                return (
                  <li key={d.date}>
                    <button
                      type="button"
                      className={`${styles.tile} ${on ? styles.tileOn : ''}`}
                      disabled={!d.bookable}
                      aria-pressed={on}
                      aria-label={t('booking.day.label', {
                        date: formatDate(lang, d.date),
                        places,
                      })}
                      onClick={() => onDay(d.date)}
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
            {allDays.length > shown && (
              <Button variant="ghost" onClick={() => setShown((n) => n + DAYS_STEP)}>
                {t('sb.reschedule.moreDays')}
              </Button>
            )}
          </>
        ))}

      {day && (
        <>
          <p className={styles.stepLabel}>{t('sb.reschedule.time', { date: formatDate(lang, day) })}</p>
          <TimeGrid
            key={day}
            shopId={shopId}
            excludeBooking={excludeBooking}
            current={current}
            day={day}
            selected={time}
            onPick={onTime}
          />
        </>
      )}
    </>
  );
}

function TimeGrid({
  shopId,
  excludeBooking,
  current,
  day,
  selected,
  onPick,
}: {
  shopId: string;
  excludeBooking?: string;
  current?: { date: string; slot: string };
  day: string;
  selected: string | null;
  onPick: (time: string) => void;
}) {
  const { t } = useI18n();
  const load = useCallback(
    () =>
      getAvailability(shopId, {
        from: day,
        days: 1,
        slotsFor: day,
        excludeBooking,
      }),
    [shopId, day, excludeBooking],
  );
  const { state, reload } = useLoad(load);

  if (state.status === 'loading') return <SkeletonGrid count={6} className={styles.grid} />;
  if (state.status === 'error') return <LoadError message={t('booking.times.loadError')} onRetry={reload} />;

  // Past times are not shown at all; taken ones stay, struck through.
  const slots = state.data.slots.filter((s) => s.available || s.reason === 'full');
  if (!slots.some((s) => s.available)) return <p className={styles.muted}>{t('booking.times.none')}</p>;

  return (
    <>
      <ul className={styles.grid}>
        {slots.map((s) => {
          const isCurrent = !!current && day === current.date && s.time === current.slot;
          const free = s.available && !isCurrent;
          const on = free && s.time === selected;
          return (
            <li key={s.time}>
              <button
                type="button"
                className={`${styles.time} ${on ? styles.tileOn : ''} ${s.available ? '' : styles.taken}`}
                disabled={!free}
                aria-pressed={on}
                onClick={() => onPick(s.time)}
              >
                <span className="mono">{s.time}</span>
                {isCurrent && <span className={styles.tileSmall}>{t('sb.reschedule.current')}</span>}
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
