import { Bell, Car as CarIcon, ChevronRight, FileCheck, History, Pencil, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { fetchCars, type Car } from '../../../data/garage';
import { useI18n } from '../../../i18n/context';
import { daysFromToday, formatDayMonth } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import { plural } from '../../../i18n/translate';
import { CAR_DOCS, urgencyOf, type CarDoc } from '../../../lib/expiry';
import { jobsOf } from '../../../lib/history';
import { useLoad } from '../../../lib/useLoad';
import { useClientBookings } from '../bookings/clientBookingsContext';
import { carHistoryPath, carPath, carReportPath, NEW_CAR_PATH, type ReportLinkState, type VehicleHistoryLinkState } from '../paths';
import styles from './garage.module.css';

/**
 * Garaj (FR §3.4, P7): the client's cars with their ITP / RCA / vignette dates — muted when far,
 * amber within 30 days, red on or after the day. Only clients have a garage.
 */
export function GarageScreen() {
  const { t, lang } = useI18n();
  const { state, reload } = useLoad(fetchCars);
  const { state: bookingsState } = useClientBookings();
  const bookings = bookingsState.status === 'ready' ? bookingsState.data.bookings : null;

  return (
    <div className={styles.page}>
      <div>
        <h1>{t('nav.client.garage')}</h1>
        {state.status === 'ready' && state.data.length > 0 && (
          <p className={styles.sub}>{plural(lang, 'unit.savedCars', state.data.length)}</p>
        )}
      </div>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('garage.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <EmptyState
            icon={CarIcon}
            title={t('garage.empty')}
            body={t('garage.emptyBody')}
            action={
              <Link to={NEW_CAR_PATH} className={buttonClass('primary')}>
                <Plus size={18} aria-hidden="true" />
                {t('garage.add')}
              </Link>
            }
          />
        ) : (
          <>
            <ul className={styles.list}>
              {state.data.map((car) => (
                <li key={car.id}>
                  <CarCard car={car} jobs={bookings ? jobsOf(bookings, car).length : null} />
                </li>
              ))}
            </ul>
            <Link to={NEW_CAR_PATH} className={buttonClass('primary', true)}>
              <Plus size={18} aria-hidden="true" />
              {t('garage.add')}
            </Link>
          </>
        ))}
    </div>
  );
}

const FROM_GARAGE: VehicleHistoryLinkState = { from: 'garage' };
const REPORT_FROM_GARAGE: ReportLinkState = { from: 'garage' };

/** `jobs`: finished jobs on this car (P16c), null while the bookings load (or did not). */
function CarCard({ car, jobs }: { car: Car; jobs: number | null }) {
  const { t, lang } = useI18n();
  const name = `${car.make} ${car.model}`;
  const anyDate = CAR_DOCS.some(({ column }) => car[column]);
  return (
    <Card>
      <div className={styles.head}>
        <span className={styles.carTile} aria-hidden="true">
          <CarIcon size={19} />
        </span>
        <div className={styles.carText}>
          <p className={styles.carName}>
            {name} {car.year && <span className={styles.year}>{car.year}</span>}
          </p>
          {car.plate && <p className={`mono ${styles.plate}`}>{car.plate}</p>}
        </div>
        <Link to={carPath(car.id)} className={styles.edit} aria-label={t('garage.edit', { car: name })}>
          <Pencil size={18} aria-hidden="true" />
        </Link>
      </div>
      {jobs === null ? null : jobs > 0 ? (
        <>
          <Link to={carHistoryPath(car.id)} state={FROM_GARAGE} className={styles.history}>
            <History size={16} aria-hidden="true" />
            <span className={styles.historyText}>{t('vh.garageRow', { jobs: plural(lang, 'unit.jobs', jobs) })}</span>
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
          {/* The paid report (T15, P16e): a secondary action, only for a car with finished jobs. */}
          <Link to={carReportPath(car.id)} state={REPORT_FROM_GARAGE} className={`${styles.history} ${styles.report}`}>
            <FileCheck size={16} aria-hidden="true" />
            <span className={styles.historyText}>{t('report.garageRow')}</span>
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
        </>
      ) : (
        <p className={styles.historyNone}>{t('vh.noJobs')}</p>
      )}
      {anyDate && (
        <ul className={styles.docs}>
          {CAR_DOCS.map(({ doc, column }) => (
            <li key={doc}>
              <DocPill doc={doc} date={car[column]} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** "ITP: în 12 zile" — text and color together, with a bell when it needs attention. */
function DocPill({ doc, date }: { doc: CarDoc; date: string | null }) {
  const { t, lang } = useI18n();
  const name = t(`doc.${doc}` as MessageKey);
  if (!date) return <span className={styles.pillMuted}>{t('garage.notSet', { doc: name })}</span>;
  const days = daysFromToday(date);
  const urgency = urgencyOf(days);
  const text =
    days < 0
      ? t('garage.expiredAgo', { doc: name, days: plural(lang, 'unit.days', -days) })
      : days === 0
        ? t('garage.today', { doc: name })
        : urgency === 'soon'
          ? t('garage.inDays', { doc: name, days: plural(lang, 'unit.days', days) })
          : t('garage.on', { doc: name, date: formatDayMonth(lang, date) });
  const cls = urgency === 'expired' ? styles.pillRed : urgency === 'soon' ? styles.pillAmber : styles.pillMuted;
  return (
    <span className={cls}>
      {urgency !== 'ok' && <Bell size={13} aria-hidden="true" />}
      {text}
    </span>
  );
}
