import { Car as CarIcon, ChevronDown, FileCheck, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { BackLink } from '../../../components/BackLink';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { ServiceIcon } from '../../../components/ServiceIcon';
import { SkeletonList } from '../../../components/Skeleton';
import { quoteOf, type ClientBooking } from '../../../data/bookings';
import { fetchCars } from '../../../data/garage';
import { getReportPrice } from '../../../data/reports';
import { useI18n } from '../../../i18n/context';
import { formatDayMonth, formatKm, formatMoney } from '../../../i18n/format';
import { plural } from '../../../i18n/translate';
import { jobDay, jobsOf, sameVehicle, sumCosts, type VehicleFields } from '../../../lib/history';
import { useLoad } from '../../../lib/useLoad';
import { HistoryQuote } from '../../history/HistoryQuote';
import { MessageLink } from '../../messages/MessageLink';
import { useClientBookings } from '../bookings/clientBookingsContext';
import {
  BOOKINGS_PATH,
  bookingPath,
  bookingReportPath,
  carReportPath,
  GARAGE_PATH,
  SEARCH_PATH,
  VEHICLE_HISTORY_PICK_PATH,
  type ReportLinkState,
  type VehicleHistoryLinkState,
} from '../paths';
import { serviceName } from '../shop/serviceGroups';
import styles from '../../history/history.module.css';

/**
 * The history of one car (FR §3.6, P16c): the car, how many jobs and how much was spent, then every
 * finished job newest first — service, shop, date, odometer, amount; opened, the accepted quote,
 * the work and "Programează din nou". One screen with three ways in: the garage card
 * (/c/garaj/:carId/istoric), Cont → "Istoricul mașinilor mele", and a finished booking
 * (/c/programari/:bookingId/istoric, which also works for a car no longer in the garage). Jobs are
 * matched to the car by plate (see `vehicleKey`), so editing or deleting the car changes nothing.
 * Under the jobs, "Generează raport oficial — 29 lei" (T15) opens the report's preview.
 * Live through ClientBookingsProvider.
 */
export function VehicleHistoryScreen() {
  const { t, lang } = useI18n();
  const { carId, bookingId } = useParams();
  const location = useLocation();
  const from = (location.state as VehicleHistoryLinkState | null)?.from ?? (carId ? 'garage' : 'bookings');
  const back =
    from === 'account' ? (
      <BackLink to={VEHICLE_HISTORY_PICK_PATH} label={t('vh.title')} />
    ) : from === 'garage' ? (
      <BackLink to={GARAGE_PATH} label={t('nav.client.garage')} />
    ) : (
      <BackLink to={BOOKINGS_PATH} label={t('nav.bookings')} />
    );

  const { state: bookingsState, reload: reloadBookings } = useClientBookings();
  const { state: carsState, reload: reloadCars } = useLoad(fetchCars);
  const { state: priceState } = useLoad(getReportPrice);

  const loading = bookingsState.status === 'loading' || carsState.status === 'loading';
  const failed = bookingsState.status === 'error' || carsState.status === 'error';
  const bookings = bookingsState.status === 'ready' ? bookingsState.data.bookings : null;
  const cars = carsState.status === 'ready' ? carsState.data : null;

  /** The car this screen is about: a garage car, or what a booking remembered of it. */
  const vehicle = useMemo((): { fields: VehicleFields; missing: 'car' | 'booking' | null } | null => {
    if (!bookings || !cars) return null;
    if (carId) {
      const car = cars.find((c) => c.id === carId);
      return car ? { fields: car, missing: null } : { fields: {}, missing: 'car' };
    }
    const booking = bookings.find((b) => b.id === bookingId);
    if (!booking) return { fields: {}, missing: 'booking' };
    const car = cars.find((c) => sameVehicle(c, booking.car_snapshot));
    return { fields: car ?? booking.car_snapshot, missing: null };
  }, [bookings, cars, carId, bookingId]);

  const jobs = useMemo(() => (bookings && vehicle ? jobsOf(bookings, vehicle.fields) : []), [bookings, vehicle]);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (loading) {
    return (
      <div className={styles.page}>
        {back}
        <SkeletonList />
      </div>
    );
  }
  if (failed || !vehicle) {
    return (
      <div className={styles.page}>
        {back}
        <LoadError
          message={t('vh.loadError')}
          onRetry={() => {
            if (bookingsState.status === 'error') reloadBookings();
            if (carsState.status === 'error') reloadCars();
          }}
        />
      </div>
    );
  }
  if (vehicle.missing) {
    return (
      <div className={styles.page}>
        {back}
        <EmptyState icon={CarIcon} title={vehicle.missing === 'car' ? t('garage.notFound') : t('vh.bookingGone')} />
      </div>
    );
  }

  const v = vehicle.fields;
  const name = [v.make, v.model].filter(Boolean).join(' ');
  return (
    <div className={styles.page}>
      {back}
      <div>
        <h1>{name || t('sb.card.noCar')}</h1>
        <p className={styles.sub}>
          {v.year && <>{v.year} · </>}
          {v.plate ? <span className={`mono ${styles.plate}`}>{v.plate}</span> : t('vh.noPlate')}
        </p>
        {jobs.length > 0 && (
          <p className={styles.sub}>
            {t('vh.summary', { jobs: plural(lang, 'unit.jobs', jobs.length), amount: formatMoney(lang, sumCosts(jobs)) })}
          </p>
        )}
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title={t('vh.empty')}
          body={t('vh.emptyBody')}
          action={
            <Link to={SEARCH_PATH} className={buttonClass('primary')}>
              {t('vh.findShop')}
            </Link>
          }
        />
      ) : (
        <>
          <ul className={styles.list}>
            {jobs.map((b) => (
              <li key={b.id}>
                <JobCard booking={b} open={open.has(b.id)} onToggle={() => toggle(b.id)} />
              </li>
            ))}
          </ul>
          <p className={styles.sub}>{t('vh.onlyServiceHub')}</p>
          {/* The paid report of this car (T15, P16e). */}
          <Link
            to={carId ? carReportPath(carId) : bookingReportPath(bookingId ?? '')}
            state={FROM_HISTORY}
            className={buttonClass('secondary', true)}
          >
            <FileCheck size={18} aria-hidden="true" />
            {priceState.status === 'ready' && priceState.data !== null
              ? t('report.buy', { price: formatMoney(lang, priceState.data) })
              : t('report.buyShort')}
          </Link>
        </>
      )}
    </div>
  );
}

const FROM_HISTORY: ReportLinkState = { from: 'history' };

/** One finished job (P16c): summary as a button; opened, the quote, the work and "book again". */
function JobCard({ booking: b, open, onToggle }: { booking: ClientBooking; open: boolean; onToggle: () => void }) {
  const { t, lang } = useI18n();
  const detailsId = `job-${b.id}`;
  const quote = quoteOf(b);
  return (
    <Card className={`${styles.card} ${open ? styles.open : ''}`}>
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={detailsId} onClick={onToggle}>
        <span className={styles.top}>
          <ServiceIcon name={b.service?.icon} className={styles.icon} />
          <span className={styles.what}>
            <span className={`${styles.service} ${styles.block}`}>{b.service ? serviceName(b.service, lang) : b.service_id}</span>
            {b.shop && (
              <span className={`${styles.muted} ${styles.block}`}>
                {b.shop.name} · {b.shop.city}
              </span>
            )}
            <span className={`${styles.muted} ${styles.block}`}>
              {formatDayMonth(lang, jobDay(b))}
              {b.odometer !== null && <span className={`mono ${styles.nowrap}`}> · {formatKm(lang, b.odometer)}</span>}
            </span>
          </span>
          <span className={styles.side}>
            {b.cost !== null && <span className={`mono ${styles.amount}`}>{formatMoney(lang, b.cost)}</span>}
            <ChevronDown size={18} className={styles.chevron} aria-hidden="true" />
          </span>
        </span>
      </button>

      {open && (
        <div id={detailsId} className={styles.details}>
          {quote && <HistoryQuote quote={quote} />}
          {b.work && (
            <dl className={styles.facts}>
              <div>
                <dt>{t('vh.work')}</dt>
                <dd>{b.work}</dd>
              </div>
            </dl>
          )}
          <p className={`mono ${styles.muted}`}>
            {t('hist.card.booking', { ref: b.ref, when: `${formatDayMonth(lang, b.date)}, ${b.slot.slice(0, 5)}` })}
          </p>
          <div className={styles.actions}>
            {b.shop && (
              <Link
                to={`${bookingPath(b.shop_id)}?pas=2&serviciu=${encodeURIComponent(b.service_id)}`}
                className={buttonClass('primary')}
              >
                {t('cb.bookAgain')}
              </Link>
            )}
            <MessageLink side="client" bookingId={b.id} />
          </div>
        </div>
      )}
    </Card>
  );
}
