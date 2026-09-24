import { Car as CarIcon, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BackLink } from '../../../components/BackLink';
import { buttonClass } from '../../../components/buttonClass';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { fetchCars } from '../../../data/garage';
import { useI18n } from '../../../i18n/context';
import { plural } from '../../../i18n/translate';
import { jobsOf, otherVehicles, type VehicleFields } from '../../../lib/history';
import { useLoad } from '../../../lib/useLoad';
import { NAV } from '../../../app/roles';
import { useClientBookings } from '../bookings/clientBookingsContext';
import { bookingCarHistoryPath, carHistoryPath, SEARCH_PATH, type VehicleHistoryLinkState } from '../paths';
import styles from './vehiclePick.module.css';

const FROM_ACCOUNT: VehicleHistoryLinkState = { from: 'account' };

/**
 * "Istoricul mașinilor mele" in Cont (FR §3.6): pick a car, see its history. The garage cars first;
 * then cars with finished jobs that are no longer in the garage, so no history is ever out of reach.
 */
export function VehiclePickScreen() {
  const { t } = useI18n();
  const { state: bookingsState, reload: reloadBookings } = useClientBookings();
  const { state: carsState, reload: reloadCars } = useLoad(fetchCars);
  const bookings = bookingsState.status === 'ready' ? bookingsState.data.bookings : null;
  const cars = carsState.status === 'ready' ? carsState.data : null;

  const back = <BackLink to={NAV.client.account.path} label={t('nav.account')} />;

  let body;
  if (bookingsState.status === 'error' || carsState.status === 'error') {
    body = (
      <LoadError
        message={t('vh.loadError')}
        onRetry={() => {
          if (bookingsState.status === 'error') reloadBookings();
          if (carsState.status === 'error') reloadCars();
        }}
      />
    );
  } else if (!bookings || !cars) {
    body = <SkeletonList />;
  } else {
    const others = otherVehicles(bookings, cars);
    body =
      cars.length === 0 && others.length === 0 ? (
        <EmptyState
          icon={CarIcon}
          title={t('vh.pickEmpty')}
          body={t('vh.pickEmptyBody')}
          action={
            <Link to={SEARCH_PATH} className={buttonClass('primary')}>
              {t('vh.findShop')}
            </Link>
          }
        />
      ) : (
        <>
          {cars.length > 0 && (
            <ul className={styles.list}>
              {cars.map((car) => (
                <li key={car.id}>
                  <VehicleRow to={carHistoryPath(car.id)} vehicle={car} jobs={jobsOf(bookings, car).length} />
                </li>
              ))}
            </ul>
          )}
          {others.length > 0 && (
            <section className={styles.section} aria-labelledby="vh-other">
              <h2 id="vh-other" className={styles.sectionTitle}>
                {t('vh.other')}
              </h2>
              <p className={styles.hint}>{t('vh.otherHint')}</p>
              <ul className={styles.list}>
                {others.map((o) => (
                  <li key={o.latest.id}>
                    <VehicleRow to={bookingCarHistoryPath(o.latest.id)} vehicle={o.latest.car_snapshot} jobs={o.jobs} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      );
  }

  return (
    <div className={styles.page}>
      {back}
      <div>
        <h1>{t('vh.title')}</h1>
        <p className={styles.hint}>{t('vh.pick')}</p>
      </div>
      {body}
    </div>
  );
}

function VehicleRow({ to, vehicle: v, jobs }: { to: string; vehicle: VehicleFields; jobs: number }) {
  const { t, lang } = useI18n();
  const name = [v.make, v.model].filter(Boolean).join(' ') || t('sb.card.noCar');
  return (
    <Link to={to} state={FROM_ACCOUNT} className={styles.row}>
      <span className={styles.carTile} aria-hidden="true">
        <CarIcon size={19} />
      </span>
      <span className={styles.text}>
        <span className={styles.name}>
          {name} {v.year && <span className={styles.year}>{v.year}</span>}
        </span>
        {v.plate && <span className={`mono ${styles.plate}`}>{v.plate}</span>}
      </span>
      <span className={styles.count}>{jobs > 0 ? plural(lang, 'unit.jobs', jobs) : t('vh.noJobs')}</span>
      <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
    </Link>
  );
}
