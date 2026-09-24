import { CalendarDays } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { buttonClass } from '../../../components/buttonClass';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { splitBookings, type ClientBooking } from '../../../data/bookings';
import { useI18n } from '../../../i18n/context';
import { useNow } from '../../../lib/useNow';
import { SEARCH_PATH } from '../paths';
import { ClientBookingCard } from './ClientBookingCard';
import { useClientBookings } from './clientBookingsContext';
import styles from './bookings.module.css';

/**
 * Programări (FR §3.5, P10b): active bookings first (soonest on top), then the ended ones (newest
 * on top), every status with its badge. The quote decision, cancelling and the review happen on
 * the cards. Live through ClientBookingsProvider: a change the shop makes shows up without
 * reloading.
 */
export function ClientBookingsScreen() {
  const { t } = useI18n();
  const { state, reload, refresh, apply, patch } = useClientBookings();
  const now = useNow();

  // Arriving here reads the list again quietly.
  useEffect(() => {
    refresh();
  }, [refresh]);

  const data = state.status === 'ready' ? state.data : null;
  const groups = useMemo(() => (data ? splitBookings(data.bookings) : null), [data]);

  const group = (title: string, items: ClientBooking[], id: string) =>
    items.length === 0 ? null : (
      <section className={styles.section} aria-labelledby={`bookings-${id}`}>
        <h2 id={`bookings-${id}`} className={styles.sectionTitle}>
          {title}
        </h2>
        <ul className={styles.list}>
          {items.map((b) => (
            <li key={b.id}>
              <ClientBookingCard
                booking={b}
                reviewWindowDays={data?.reviewWindowDays ?? 60}
                now={now}
                onDone={apply}
                onReviewed={(id, review) => patch(id, { review })}
                onStale={refresh}
              />
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className={styles.page}>
      <h1>{t('nav.bookings')}</h1>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('bookings.loadError')} onRetry={reload} />}
      {groups &&
        (groups.active.length + groups.past.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={t('bookings.empty')}
            body={t('bookings.emptyBody')}
            action={
              <Link to={SEARCH_PATH} className={buttonClass('primary')}>
                {t('bookings.findShop')}
              </Link>
            }
          />
        ) : (
          <>
            {group(t('bookings.active'), groups.active, 'active')}
            {group(t('bookings.past'), groups.past, 'past')}
          </>
        ))}
    </div>
  );
}
