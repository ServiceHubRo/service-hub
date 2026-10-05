import { Car as CarIcon, EyeOff, Phone } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { BackLink } from '../../../components/BackLink';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { ServiceIcon } from '../../../components/ServiceIcon';
import { SkeletonList } from '../../../components/Skeleton';
import { toRpcError } from '../../../data/rpc';
import { fetchVehicleFile, lastKnownOdometer, type OwnVehicleFileJob, type VehicleFileJob } from '../../../data/vehicleFile';
import { useI18n } from '../../../i18n/context';
import { formatDayMonth, formatKm, formatMoney } from '../../../i18n/format';
import { plural } from '../../../i18n/translate';
import { formatPhone, normalizePhone } from '../../../lib/validators';
import { useLoad } from '../../../lib/useLoad';
import { useShopBookings } from '../bookings/shopBookingsContext';
import { SHOP_HISTORY_PATH, shopBookingsLink, type VehicleFileFrom } from '../paths';
import history from '../../history/history.module.css';
import styles from './vehicleFile.module.css';

/**
 * Fișa mașinii (T27): the car of one booking — make, model, plate, VIN, the client — and every job
 * done on it at this shop (with the amount), then, when the client agreed on an open booking for this
 * car, the jobs at other shops through Service-Hub: day, odometer, services, accepted lines and work,
 * never a price or a shop. The database decides what is shown (`shop_vehicle_file`); the screen
 * reads it again quietly whenever the shop's open bookings change (the client turning the agreement
 * on or off arrives through the bookings' Realtime).
 */
export function VehicleFileScreen({ from }: { from: VehicleFileFrom }) {
  const { t, lang } = useI18n();
  const { bookingId = '' } = useParams();
  const load = useCallback(() => fetchVehicleFile(bookingId), [bookingId]);
  const { state, reload, setData } = useLoad(load);

  // The client's agreement changes on their side: follow the shop's live list of open bookings.
  const { state: bookingsState } = useShopBookings();
  const signature =
    bookingsState.status === 'ready'
      ? bookingsState.data.bookings.map((b) => `${b.id}:${b.status}:${b.share_history ? 1 : 0}`).join(',')
      : null;
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (signature === null) return;
    if (seen.current !== null && seen.current !== signature) {
      fetchVehicleFile(bookingId).then(setData, () => {}); // the file on screen stays; the next change reads again
    }
    seen.current = signature;
  }, [signature, bookingId, setData]);

  const back =
    from === 'history' ? (
      <BackLink to={SHOP_HISTORY_PATH} label={t('nav.shop.history')} />
    ) : (
      <BackLink to={shopBookingsLink({ booking: bookingId })} label={t('nav.bookings')} />
    );

  if (state.status === 'loading') {
    return (
      <div className={history.page}>
        {back}
        <SkeletonList />
      </div>
    );
  }
  if (state.status === 'error') {
    const gone = toRpcError(state.error).code === 'booking_not_found';
    return (
      <div className={history.page}>
        {back}
        {gone ? <EmptyState icon={CarIcon} title={t('vh.bookingGone')} /> : <LoadError message={t('vf.loadError')} onRetry={reload} />}
      </div>
    );
  }

  const file = state.data;
  const car = file.car;
  const name = [car.make, car.model].filter(Boolean).join(' ');
  const km = lastKnownOdometer(file);
  const phone = file.client_phone;
  const shopName = bookingsState.status === 'ready' ? bookingsState.data.shop.name : '';

  return (
    <div className={history.page}>
      {back}
      <h1>{t('vf.title')}</h1>

      <Card className={styles.head}>
        <p className={styles.carName}>
          {name || t('sb.card.noCar')}
          {car.year && <span className={history.muted}> {car.year}</span>}
        </p>
        <p className={styles.plateRow}>
          {car.plate ? <span className={`mono ${history.plate}`}>{car.plate}</span> : <span className={history.muted}>{t('vh.noPlate')}</span>}
          {car.vin && (
            <span className={history.muted}>
              {t('vf.vin')} <span className="mono">{car.vin}</span>
            </span>
          )}
        </p>
        <div className={styles.client}>
          <span>{file.client_name || t('sb.card.deletedClient')}</span>
          {phone && (
            <a
              className={`mono ${history.phone}`}
              href={`tel:${normalizePhone(phone) ?? phone.replace(/[^\d+]/g, '')}`}
              aria-label={t('sb.card.call', { name: file.client_name ?? '', phone: formatPhone(phone) })}
            >
              <Phone size={15} aria-hidden="true" />
              {formatPhone(phone)}
            </a>
          )}
        </div>
        {km !== null && <p className={history.muted}>{t('vf.lastKm', { km: formatKm(lang, km) })}</p>}
      </Card>

      <section className={styles.section} aria-labelledby="vf-own">
        <h2 id="vf-own" className={styles.sectionTitle}>
          {shopName ? t('vf.own', { shop: shopName }) : t('vf.ownFallback')}
          {file.own.length > 0 && <span className={history.muted}> · {plural(lang, 'unit.jobs', file.own.length)}</span>}
        </h2>
        {file.own.length === 0 ? (
          <p className={history.muted}>{t('vf.ownEmpty')}</p>
        ) : (
          <ul className={history.list}>
            {file.own.map((job) => (
              <li key={job.id}>
                <JobCard job={job} own={job} currentClient={file.client_name} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="vf-others">
        <h2 id="vf-others" className={styles.sectionTitle}>
          {t('vf.others')}
          {file.share === 'shared' && file.others.length > 0 && (
            <span className={history.muted}> · {plural(lang, 'unit.jobs', file.others.length)}</span>
          )}
        </h2>
        {file.share === 'shared' ? (
          <>
            <p className={history.muted}>{t('vf.othersNote')}</p>
            {file.others.length === 0 ? (
              <p className={history.muted}>{t('vf.othersEmpty')}</p>
            ) : (
              <ul className={history.list}>
                {file.others.map((job) => (
                  <li key={job.id}>
                    <JobCard job={job} />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <Card inset className={styles.hidden}>
            <EyeOff size={18} aria-hidden="true" className={styles.hiddenIcon} />
            <p>{t(file.share === 'not_shared' ? 'vf.notShared' : 'vf.noActive')}</p>
          </Card>
        )}
      </section>

      <p className={history.sub}>{t('vf.onlyServiceHub')}</p>
    </div>
  );
}

/** One finished job: services, day and odometer; the accepted lines and the work; the amount on own jobs. */
function JobCard({ job, own, currentClient }: { job: VehicleFileJob; own?: OwnVehicleFileJob; currentClient?: string | null }) {
  const { t, lang } = useI18n();
  const otherOwner = own && own.client_name && currentClient && own.client_name !== currentClient ? own.client_name : null;
  return (
    <Card className={history.card}>
      <div className={history.top}>
        <ServiceIcon name={job.service_icon} className={history.icon} />
        <div className={history.what}>
          <p className={history.service}>{own?.imported ? t('imp.badge') : lang === 'ro' ? job.service_ro : job.service_en}</p>
          <p className={history.muted}>
            {formatDayMonth(lang, job.date)}
            {job.odometer !== null && <span className={`mono ${history.nowrap}`}> · {formatKm(lang, job.odometer)}</span>}
            {own && !own.imported && <span className={`mono ${history.nowrap}`}> · {own.ref}</span>}
          </p>
          {otherOwner && <p className={history.muted}>{otherOwner}</p>}
        </div>
        {own && own.cost !== null && <span className={`mono ${history.amount}`}>{formatMoney(lang, own.cost)}</span>}
      </div>
      {(job.items.length > 0 || job.work) && (
        <dl className={history.facts}>
          {job.items.length > 0 && (
            <div>
              <dt>{t('vf.lines')}</dt>
              <dd>{job.items.join(', ')}</dd>
            </div>
          )}
          {job.work && (
            <div>
              <dt>{t('vh.work')}</dt>
              <dd className={history.work}>{job.work}</dd>
            </div>
          )}
        </dl>
      )}
    </Card>
  );
}
