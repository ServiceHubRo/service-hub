import { useCallback, useMemo, useState } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { LoadError } from '../../../components/LoadError';
import { SkeletonGrid } from '../../../components/Skeleton';
import {
  getAvailability,
  RELOAD_AVAILABILITY_CODES,
  rescheduleBooking,
  rpcErrorMessage,
  toRpcError,
  type Booking,
} from '../../../data/rpc';
import type { ShopBooking } from '../../../data/shopBookings';
import { useI18n } from '../../../i18n/context';
import { formatDate, formatDayTile } from '../../../i18n/format';
import { plural } from '../../../i18n/translate';
import { bookingDays } from '../../../lib/bookingDays';
import { useLoad } from '../../../lib/useLoad';
import { Panel, PanelButtons } from './BookingPanels';
import styles from './shopBookings.module.css';

/** How far ahead the shop can move a booking from this panel, and how many open days show at once. */
const HORIZON_DAYS = 92;
const DAYS_STEP = 12;

/**
 * "Reprogramează" (P8, ARCHITECTURE §4): the shop's own calendar — no minimum notice, days and
 * times already past never offered — with the place this booking holds now counted as free. Full
 * days are dimmed and taken times struck through. The database checks the slot again at submit; if
 * it filled up or passed meanwhile, the booking stays exactly as it was and the days reload.
 */
export function ReschedulePanel({
  booking,
  shopId,
  act,
  onClose,
}: {
  booking: ShopBooking;
  shopId: string;
  /** Runs the move and hands the result to the list (ShopBookingCard). */
  act: (run: () => Promise<Booking>) => Promise<void>;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const load = useCallback(
    () => getAvailability(shopId, { days: HORIZON_DAYS, excludeBooking: booking.id }),
    [shopId, booking.id],
  );
  const { state, reload } = useLoad(load);
  const [shown, setShown] = useState(DAYS_STEP);
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const allDays = useMemo(
    () => (state.status === 'ready' ? bookingDays(state.data.days, 0, new Date(), HORIZON_DAYS) : []),
    [state],
  );
  const days = allDays.slice(0, shown);

  return (
    <Panel title={t('sb.reschedule.title')}>
      {notice && <Banner tone="warning">{notice}</Banner>}
      <p className={styles.panelBody}>
        {t('sb.reschedule.now', { when: `${formatDate(lang, booking.date)}, ${booking.slot}` })}
      </p>
      <p className={styles.stepLabel}>{t('sb.reschedule.day')}</p>
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
                      aria-label={t('booking.day.label', { date: formatDate(lang, d.date), places })}
                      onClick={() => {
                        setDay(d.date);
                        setTime(null);
                      }}
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
            booking={booking}
            day={day}
            selected={time}
            onPick={setTime}
          />
        </>
      )}

      <PanelButtons
        label={booking.status === 'pending' ? t('sb.reschedule.submitConfirm') : t('sb.reschedule.submit')}
        disabled={!day || !time}
        onAction={async (requestId) => {
          if (!day || !time) return;
          try {
            await act(() => rescheduleBooking(booking.id, day, time, requestId));
          } catch (e) {
            if (!RELOAD_AVAILABILITY_CODES.has(toRpcError(e).code)) throw e;
            // The calendar was out of date: say why, show it fresh, nothing was moved.
            setNotice(rpcErrorMessage(lang, e));
            setDay(null);
            setTime(null);
            reload();
          }
        }}
        onClose={onClose}
      />
    </Panel>
  );
}

function TimeGrid({
  shopId,
  booking,
  day,
  selected,
  onPick,
}: {
  shopId: string;
  booking: ShopBooking;
  day: string;
  selected: string | null;
  onPick: (time: string) => void;
}) {
  const { t } = useI18n();
  const load = useCallback(
    () => getAvailability(shopId, { from: day, days: 1, slotsFor: day, excludeBooking: booking.id }),
    [shopId, day, booking.id],
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
          const current = day === booking.date && s.time === booking.slot;
          const free = s.available && !current;
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
                {current && <span className={styles.tileSmall}>{t('sb.reschedule.current')}</span>}
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
