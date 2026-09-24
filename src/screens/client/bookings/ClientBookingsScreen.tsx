import { CalendarDays } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../../app/sessionContext';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { ServiceIcon } from '../../../components/ServiceIcon';
import { SkeletonList } from '../../../components/Skeleton';
import { StatusBadge } from '../../../components/StatusBadge';
import { fetchClientBookings, splitBookings, type ClientBooking } from '../../../data/bookings';
import { subscribeRows } from '../../../data/realtime';
import type { Booking } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { formatDate } from '../../../i18n/format';
import { useLoad } from '../../../lib/useLoad';
import { SEARCH_PATH } from '../paths';
import { serviceName } from '../shop/serviceGroups';
import styles from './bookings.module.css';

/**
 * Programări (FR §3.5, P10b) — the basic cards of T07: service, shop, day and time, car, status.
 * Live: a change the shop makes shows up without reloading (Realtime, filtered to this client).
 * The quote decision, cancelling and the review arrive in T09.
 */
export function ClientBookingsScreen() {
  const { t } = useI18n();
  const { user } = useSession();
  const clientId = user?.id ?? '';
  const load = useCallback(() => fetchClientBookings(clientId), [clientId]);
  const { state, reload, setData } = useLoad(load);

  // The latest list, for the realtime handler (which is set up once).
  const known = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (state.status === 'ready') known.current = new Set(state.data.map((b) => b.id));
  }, [state]);

  useEffect(() => {
    if (!clientId) return;
    let alive = true;
    const refresh = () => {
      fetchClientBookings(clientId).then(
        (data) => {
          if (alive) setData(data);
        },
        () => {}, // the list on screen stays; the next change or reconnect tries again
      );
    };
    const stop = subscribeRows<Booking>({
      channel: `client-bookings:${clientId}`,
      table: 'bookings',
      filter: `client_id=eq.${clientId}`,
      onChange: (payload) => {
        const row = payload.new as Partial<Booking>;
        if (payload.eventType === 'UPDATE' && row.id && known.current.has(row.id)) {
          const { status, date, slot, note } = row as Booking;
          setData((prev) => prev.map((b) => (b.id === row.id ? { ...b, status: status as ClientBooking['status'], date, slot, note } : b)));
        } else {
          refresh(); // a new booking (from another device): its shop and service names come with a read
        }
      },
      onResync: refresh,
    });
    return () => {
      alive = false;
      stop();
    };
  }, [clientId, setData]);

  const groups = useMemo(() => (state.status === 'ready' ? splitBookings(state.data) : null), [state]);

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
            <Group title={t('bookings.active')} items={groups.active} id="active" />
            <Group title={t('bookings.past')} items={groups.past} id="past" />
          </>
        ))}
    </div>
  );
}

function Group({ title, items, id }: { title: string; items: ClientBooking[]; id: string }) {
  if (items.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby={`bookings-${id}`}>
      <h2 id={`bookings-${id}`} className={styles.sectionTitle}>
        {title}
      </h2>
      <ul className={styles.list}>
        {items.map((b) => (
          <li key={b.id}>
            <BookingCard booking={b} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function BookingCard({ booking: b }: { booking: ClientBooking }) {
  const { lang } = useI18n();
  const car = [[b.car_snapshot.make, b.car_snapshot.model].filter(Boolean).join(' '), b.car_snapshot.plate].filter(Boolean).join(' · ');
  return (
    <Card highlight={b.status === 'quote_sent'} className={styles.card}>
      <div className={styles.top}>
        <ServiceIcon name={b.service?.icon} className={styles.icon} />
        <div className={styles.what}>
          <p className={styles.service}>{b.service ? serviceName(b.service, lang) : b.service_id}</p>
          {b.shop && (
            <p className={styles.muted}>
              {b.shop.name} · {b.shop.city}
            </p>
          )}
        </div>
        <StatusBadge status={b.status} />
      </div>
      <p className={styles.when}>
        <span className="mono">
          {formatDate(lang, b.date)}, {b.slot.slice(0, 5)}
        </span>
        {car && <span className={styles.muted}> · {car}</span>}
      </p>
      {b.note && <p className={styles.note}>{b.note}</p>}
    </Card>
  );
}
