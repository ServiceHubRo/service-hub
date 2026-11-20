import { Car as CarIcon, ChevronRight, Copy, FileCheck, History, Pencil, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { Button } from '../../../components/Button';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { ListDetailLayout } from '../../../components/ListDetailLayout';
import { PageHeader } from '../../../components/PageHeader';
import { SkeletonList } from '../../../components/Skeleton';
import { fetchCars, fetchOilStandard, mergeCars, type Car } from '../../../data/garage';
import { canRetryRpc, rpcErrorMessage } from '../../../data/rpc';
import { fetchMyImportedJobsQuietly } from '../../../data/myImported';
import { useI18n } from '../../../i18n/context';
import { daysFromToday, formatDayMonth, formatMonthShortYear } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import { plural } from '../../../i18n/translate';
import { CAR_DOCS, urgencyOf, type CarDoc } from '../../../lib/expiry';
import { jobsOf, sameVehicle } from '../../../lib/history';
import { lastOilChange, oilDue } from '../../../lib/oil';
import { newRequestId } from '../../../lib/requestId';
import { useLoad } from '../../../lib/useLoad';
import { duplicateGroups } from '../../../lib/vehicleIdentity';
import { useClientBookings } from '../bookings/clientBookingsContext';
import { carHistoryPath, carPath, carReportPath, GARAGE_PATH, NEW_CAR_PATH, type ReportLinkState, type VehicleHistoryLinkState } from '../paths';
import { ExpiryRing } from './ExpiryRing';
import styles from './garage.module.css';

/**
 * Garaj (FR §3.4, P7): the client's cars with their ITP / RCA / vignette dates — muted when far,
 * amber within 30 days, red on or after the day. Only clients have a garage.
 */
export function GarageScreen({ selectedCarId, detail, wide = false }: { selectedCarId?: string; detail?: ReactNode; wide?: boolean } = {}) {
  const { t, lang } = useI18n();
  const { state, reload, setData } = useLoad(fetchCars);
  // The cars stay on screen while a form, a history or a report opens beside them: after a save or a
  // change of the address, they are read again, quietly (a new car, new dates).
  const { pathname } = useLocation();
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (pathname === firstPath.current) return;
    firstPath.current = pathname;
    fetchCars().then(setData, () => {});
  }, [pathname, setData]);
  const { state: bookingsState } = useClientBookings();
  const bookings = bookingsState.status === 'ready' ? bookingsState.data.bookings : null;
  const { state: oilState } = useLoad(fetchOilStandard);
  const oilStandard = oilState.status === 'ready' ? oilState.data : null;
  // T31b: jobs the shops imported for this client count in each car's history.
  const { state: importedState } = useLoad(fetchMyImportedJobsQuietly);
  const imported = importedState.status === 'ready' ? importedState.data : [];

  const cars = state.status === 'ready' ? state.data : [];
  const header = (
    <PageHeader
      title={t('nav.client.garage')}
      subtitle={state.status === 'ready' && cars.length > 0 ? plural(lang, 'unit.savedCars', cars.length) : undefined}
      actions={
        // The add, top right, like every add (docs/MODEL_DE_FOLOSIRE.md P12).
        state.status === 'ready' && cars.length > 0 ? (
          <Link to={NEW_CAR_PATH} className={buttonClass('primary')} aria-label={t('garage.add')}>
            <Plus size={18} aria-hidden="true" />
            {t('action.add')}
          </Link>
        ) : undefined
      }
    />
  );

  let list;
  if (state.status === 'loading') list = <SkeletonList cards />;
  else if (state.status === 'error') list = <LoadError message={t('garage.loadError')} onRetry={reload} />;
  else if (cars.length === 0)
    list = (
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
    );
  else
    list = (
      <>
        {/* T66: copies of one car the garage already had before the check existed; the owner merges them. */}
        {duplicateGroups(cars).map((group) => (
          <DuplicateCard
            key={group.map((c) => c.id).join()}
            cars={group}
            jobs={(car) => (bookings ? jobsOf(bookings, car).length : 0)}
            onMerged={reload}
          />
        ))}
        <ul className={styles.list} data-layout="cards">
          {cars.map((car) => (
            <li key={car.id}>
              <CarCard
                car={car}
                selected={car.id === selectedCarId}
                jobs={bookings ? jobsOf(bookings, car).length : null}
                importedJobs={imported.filter((j) => sameVehicle(car, j.car_snapshot)).length}
                // The oil change shows on every car whose reminder is on: set or not, with or without a service history.
                oil={
                  oilStandard?.enabled && bookings
                    ? { due: oilDue(lastOilChange(car, bookings), car.oil_change_months ?? oilStandard.months) }
                    : null
                }
              />
            </li>
          ))}
        </ul>
      </>
    );

  // Beside the cards (a laptop), what is opened from a card — its form, its history, its report — stands
  // on the right (C8, Eduard, 21 Nov 2026); on a phone each is a page, as before.
  if (wide && detail)
    return (
      <div className={styles.page}>
        <ListDetailLayout wide open={false} backTo={GARAGE_PATH} backLabel={t('nav.client.garage')} header={header} list={list} detail={detail} />
      </div>
    );
  return (
    <div className={styles.page}>
      {header}
      {list}
    </div>
  );
}

/**
 * Two (or more) records of the same car (T66). One merge at a time: the record with more jobs is kept
 * by default, the other's bookings and reports move to it and the copy goes; a third copy shows again.
 */
function DuplicateCard({ cars, jobs, onMerged }: { cars: Car[]; jobs: (car: Car) => number; onMerged: () => void }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [swap, setSwap] = useState(false);
  const [requestId, setRequestId] = useState(newRequestId);
  const [first, second] = cars[0] && cars[1] && jobs(cars[1]) > jobs(cars[0]) ? [cars[1], cars[0]] : [cars[0], cars[1]];
  if (!first || !second) return null;
  const [keep, drop] = swap ? [second, first] : [first, second];
  const label = (car: Car) => [`${car.make} ${car.model}`, car.plate].filter(Boolean).join(' · ');
  const byVin = Boolean(first.vin && second.vin);
  const merge = async () => {
    await mergeCars(keep.id, drop.id, requestId);
    setRequestId(newRequestId());
    setOpen(false);
    onMerged();
  };
  return (
    <Card className={styles.dup} role="group" aria-labelledby={`dup-${first.id}`}>
      <div className={styles.dupHead}>
        <span className={styles.carTile} aria-hidden="true">
          <Copy size={18} />
        </span>
        <div>
          <p id={`dup-${first.id}`} className={styles.confirmTitle}>
            {t('garage.dupTitle')}
          </p>
          <p className={styles.sub}>
            {t('garage.dupBody', {
              a: label(first),
              b: label(second),
              key: t(byVin ? 'garage.dupKeyVin' : 'garage.dupKeyPlate'),
            })}
          </p>
        </div>
      </div>
      {open ? (
        <div className={styles.confirmActions}>
          <p className={styles.dupQuestion}>{t('garage.mergeConfirm', { keep: label(keep), drop: label(drop) })}</p>
          <ActionButton onAction={merge} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
            {t('garage.mergeYes')}
          </ActionButton>
          <Button block onClick={() => setSwap((v) => !v)}>
            {t('garage.mergeSwap')}
          </Button>
          <Button block variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        <Button block onClick={() => setOpen(true)}>
          {t('garage.merge')}
        </Button>
      )}
    </Card>
  );
}

const FROM_GARAGE: VehicleHistoryLinkState = { from: 'garage' };
const REPORT_FROM_GARAGE: ReportLinkState = { from: 'garage' };

/**
 * `jobs`: finished jobs on this car (P16c), null while the bookings load (or did not). `oil`: the oil
 * change's reminder (T30) — `due` is when the next one is, null when not known; null when the reminder
 * is off. The documents and the oil change show on every car, with or without a service history.
 * `selected`: the car whose form, history or report is open beside the list.
 */
function CarCard({
  car,
  selected,
  jobs,
  importedJobs,
  oil,
}: {
  car: Car;
  selected: boolean;
  jobs: number | null;
  importedJobs: number;
  oil: { due: string | null } | null;
}) {
  const { t, lang } = useI18n();
  const name = `${car.make} ${car.model}`;
  return (
    <Card highlight={selected} aria-current={selected ? 'true' : undefined}>
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
        {/* Every car has both rows, with or without jobs: "Istoric — 0 lucrări" and the report, whose own
            screen explains that there is nothing to report yet. */}
        {jobs !== null && (
          <>
            <Link to={carHistoryPath(car.id)} state={FROM_GARAGE} className={styles.history}>
              <History size={16} aria-hidden="true" />
              <span className={styles.historyText}>{t('vh.garageRow', { jobs: plural(lang, 'unit.jobs', jobs + importedJobs) })}</span>
              <ChevronRight size={18} aria-hidden="true" />
            </Link>
            {/* The paid report (T15, P16e), a secondary action. */}
            <Link to={carReportPath(car.id)} state={REPORT_FROM_GARAGE} className={`${styles.history} ${styles.report}`}>
              <FileCheck size={16} aria-hidden="true" />
              <span className={styles.historyText}>{t('report.garageRow')}</span>
              <ChevronRight size={18} aria-hidden="true" />
            </Link>
          </>
        )}
      </div>
      <ul className={styles.docs}>
        {CAR_DOCS.map(({ doc, column }) => (
          <li key={doc}>
            <DocPill doc={doc} date={car[column]} />
          </li>
        ))}
        {oil && (
          <li>
            <OilPill due={oil.due} />
          </li>
        )}
      </ul>
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

/** The oil change: the month only; amber within 30 days, red once the day has passed (T30); „nesetat” when not known. */
function OilPill({ due }: { due: string | null }) {
  const { t, lang } = useI18n();
  if (!due) {
    return (
      <span className={styles.docTile}>
        <ExpiryRing days={null} urgency={null} />
        <span className={styles.docName}>{t('garage.oil')}</span>
        <span className={styles.docWhen}>{t('garage.when.notSet')}</span>
      </span>
    );
  }
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
