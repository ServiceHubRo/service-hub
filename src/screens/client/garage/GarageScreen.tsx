import { Car as CarIcon, ChevronRight, FileCheck, History, Pencil, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { PageHeader } from '../../../components/PageHeader';
import { SkeletonList } from '../../../components/Skeleton';
import { fetchCars, fetchOilStandard, type Car } from '../../../data/garage';
import { fetchMyImportedJobsQuietly } from '../../../data/myImported';
import { useI18n } from '../../../i18n/context';
import { daysFromToday, formatDayMonth, formatMonthShortYear } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import { plural } from '../../../i18n/translate';
import { CAR_DOCS, urgencyOf, type CarDoc } from '../../../lib/expiry';
import { jobsOf, sameVehicle } from '../../../lib/history';
import { lastOilChange, oilDue } from '../../../lib/oil';
import { useLoad } from '../../../lib/useLoad';
import { useClientBookings } from '../bookings/clientBookingsContext';
import { carHistoryPath, carPath, carReportPath, NEW_CAR_PATH, type ReportLinkState, type VehicleHistoryLinkState } from '../paths';
import { ExpiryRing } from './ExpiryRing';
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
  const { state: oilState } = useLoad(fetchOilStandard);
  const oilStandard = oilState.status === 'ready' ? oilState.data : null;
  // T31b: jobs the shops imported for this client count in each car's history.
  const { state: importedState } = useLoad(fetchMyImportedJobsQuietly);
  const imported = importedState.status === 'ready' ? importedState.data : [];

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('nav.client.garage')}
        subtitle={state.status === 'ready' && state.data.length > 0 ? plural(lang, 'unit.savedCars', state.data.length) : undefined}
      />
      {state.status === 'loading' && <SkeletonList cards />}
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
            <ul className={styles.list} data-layout="cards">
              {state.data.map((car) => (
                <li key={car.id}>
                  <CarCard
                    car={car}
                    jobs={bookings ? jobsOf(bookings, car).length : null}
                    importedJobs={imported.filter((j) => sameVehicle(car, j.car_snapshot)).length}
                    oilDue={
                      bookings && oilStandard?.enabled
                        ? oilDue(lastOilChange(car, bookings), car.oil_change_months ?? oilStandard.months)
                        : null
                    }
                  />
                </li>
              ))}
            </ul>
            <Link to={NEW_CAR_PATH} className={buttonClass('primary', true, styles.add)}>
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

/**
 * `jobs`: finished jobs on this car (P16c), null while the bookings load (or did not). `oilDue`: when
 * the next oil change is due (T30), null when unknown.
 */
function CarCard({
  car,
  jobs,
  importedJobs,
  oilDue,
}: {
  car: Car;
  jobs: number | null;
  importedJobs: number;
  oilDue: string | null;
}) {
  const { t, lang } = useI18n();
  const name = `${car.make} ${car.model}`;
  const anyDate = CAR_DOCS.some(({ column }) => car[column]) || oilDue !== null;
  return (
    <Card className={anyDate ? styles.carSplit : undefined}>
      {/* A wide card (T58): the car and its links on the left, the documents on the right. */}
      <div className={styles.carMain}>
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
        {jobs === null ? null : jobs + importedJobs > 0 ? (
          <>
            <Link to={carHistoryPath(car.id)} state={FROM_GARAGE} className={styles.history}>
              <History size={16} aria-hidden="true" />
              <span className={styles.historyText}>{t('vh.garageRow', { jobs: plural(lang, 'unit.jobs', jobs + importedJobs) })}</span>
              <ChevronRight size={18} aria-hidden="true" />
            </Link>
            {/* The paid report (T15, P16e): a secondary action, only for a car with jobs done through Service-Hub. */}
            {jobs > 0 && (
              <Link to={carReportPath(car.id)} state={REPORT_FROM_GARAGE} className={`${styles.history} ${styles.report}`}>
                <FileCheck size={16} aria-hidden="true" />
                <span className={styles.historyText}>{t('report.garageRow')}</span>
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
            )}
          </>
        ) : (
          <p className={styles.historyNone}>{t('vh.noJobs')}</p>
        )}
      </div>
      {anyDate && (
        <ul className={styles.docs}>
          {CAR_DOCS.map(({ doc, column }) => (
            <li key={doc}>
              <DocPill doc={doc} date={car[column]} />
            </li>
          ))}
          {oilDue && (
            <li>
              <OilPill due={oilDue} />
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

/** One document: its ring, its name and when it expires, centered in a tile of its own. */
function DocPill({ doc, date }: { doc: CarDoc; date: string | null }) {
  const { t, lang } = useI18n();
  const name = t(`doc.${doc}` as MessageKey);
  if (!date) {
    return (
      <span className={styles.docTile}>
        <ExpiryRing days={null} urgency={null} />
        <span className={styles.docName}>{name}</span>
        <span className={styles.docWhen}>{t('garage.when.notSet')}</span>
      </span>
    );
  }
  const days = daysFromToday(date);
  const urgency = urgencyOf(days);
  const when =
    days < 0
      ? t('garage.when.expired', { days: plural(lang, 'unit.days', -days) })
      : days === 0
        ? t('garage.when.today')
        : urgency === 'soon'
          ? t('garage.when.in', { days: plural(lang, 'unit.days', days) })
          : formatDayMonth(lang, date);
  return (
    <span className={`${styles.docTile} ${styles[`doc_${urgency}`]}`}>
      <ExpiryRing days={days} urgency={urgency} />
      <span className={styles.docName}>{name}</span>
      <span className={styles.docWhen}>{when}</span>
    </span>
  );
}

/** The oil change: the month only; amber within 30 days, red once the day has passed (T30). */
function OilPill({ due }: { due: string }) {
  const { t, lang } = useI18n();
  const days = daysFromToday(due);
  const urgency = urgencyOf(days);
  // Short, so the tile keeps to one line: „oct.”, „sept. 2027”.
  const month = formatMonthShortYear(lang, due);
  return (
    <span className={`${styles.docTile} ${styles[`doc_${urgency}`]}`}>
      <ExpiryRing days={days} urgency={urgency} />
      <span className={styles.docName}>{t('garage.oil')}</span>
      <span className={styles.docWhen}>{days < 0 ? t('garage.oil.past', { month }) : t('garage.oil.in', { month })}</span>
    </span>
  );
}
