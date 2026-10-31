import { CalendarDays, CalendarPlus, Clock, SearchX, Store, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ChoiceFilters } from '../../components/Filters';
import { EmptyState } from '../../components/EmptyState';
import { useI18n } from '../../i18n/context';
import { formatDate, formatMoney } from '../../i18n/format';
import { filterJobs, JOB_GROUPS, jobShops, jobStage, NO_JOB_FILTER, sortJobs, type FleetJob, type JobFilter, type JobGroup } from '../../lib/fleet';
import { JobStagePill } from './FleetPills';
import { FleetQuoteBody } from './FleetQuoteCard';
import { useFleet, vehicleLabel } from './fleetContext';
import styles from './fleet.module.css';

/**
 * Programări (T63d): the company's bookings — all of them for admin, manager and accountant, a
 * driver's own and their vehicle's — the quotes waiting for the company first. One "Filtre" button
 * (status, vehicle, shop), one "Programează la service". A waiting quote opens inside its booking,
 * answered by those who may (FleetQuoteBody); amounts only for those who see money.
 */
export function FleetBookings({ initialGroup }: { initialGroup?: string }) {
  const { t } = useI18n();
  const { data, allowed, actions, mode } = useFleet();
  const [filter, setFilter] = useState<JobFilter>(() => ({
    ...NO_JOB_FILTER,
    group: JOB_GROUPS.includes(initialGroup as JobGroup) ? (initialGroup as JobGroup) : 'all',
  }));
  const shown = useMemo(() => sortJobs(filterJobs(data.jobs, filter)), [data.jobs, filter]);
  const shops = useMemo(() => jobShops(data.jobs), [data.jobs]);
  const vehicles = useMemo(() => {
    const ids = new Set(data.jobs.map((j) => j.vehicle_id));
    return data.vehicles.filter((v) => ids.has(v.id));
  }, [data.jobs, data.vehicles]);
  const set = (patch: Partial<JobFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const bookable = allowed('bookings.create') && data.vehicles.some((v) => !v.archived_at);

  const bookButton = bookable ? (
    <Button
      variant="primary"
      disabled={mode !== 'live' || !actions}
      title={mode !== 'live' ? t('fleet.preview.notSaved') : undefined}
      onClick={() => actions?.book(null)}
    >
      <CalendarPlus size={18} aria-hidden="true" /> {t('fleet.bk.book')}
    </Button>
  ) : null;

  if (data.jobs.length === 0) {
    return <EmptyState icon={CalendarDays} title={t('fleet.bk.empty')} body={t('fleet.bk.emptyBody')} action={bookButton ?? undefined} />;
  }

  return (
    <div className={styles.stack}>
      <ChoiceFilters
        groups={[
          {
            key: 'group',
            title: t('fleet.col.status'),
            options: JOB_GROUPS.map((g) => ({ value: g, label: t(`fleet.bk.group.${g}`) })),
            value: filter.group,
            defaultValue: 'all',
            onChange: (v) => set({ group: v as JobGroup }),
          },
          ...(vehicles.length > 1
            ? [
                {
                  key: 'vehicle',
                  title: t('fleet.bk.vehicle'),
                  options: [{ value: '', label: t('fleet.bk.anyVehicle') }, ...vehicles.map((v) => ({ value: v.id, label: vehicleLabel(v) }))],
                  value: filter.vehicleId ?? '',
                  defaultValue: '',
                  onChange: (v: string) => set({ vehicleId: v || null }),
                },
              ]
            : []),
          ...(shops.length > 1
            ? [
                {
                  key: 'shop',
                  title: t('fleet.bk.shop'),
                  options: [{ value: '', label: t('fleet.bk.anyShop') }, ...shops.map((s) => ({ value: s.id, label: s.name }))],
                  value: filter.shopId ?? '',
                  defaultValue: '',
                  onChange: (v: string) => set({ shopId: v || null }),
                },
              ]
            : []),
        ]}
        onClearAll={() => setFilter(NO_JOB_FILTER)}
        doneLabel={t('fleet.filters.show', { n: shown.length })}
        end={bookButton ?? undefined}
      />

      {shown.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={t('fleet.bk.noMatch')}
          action={<Button onClick={() => setFilter(NO_JOB_FILTER)}>{t('fleet.bk.reset')}</Button>}
        />
      ) : (
        <ul className={styles.bookingList}>
          {shown.map((j) => (
            <li key={j.id}>
              <BookingCard job={j} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BookingCard({ job }: { job: FleetJob }) {
  const { t, lang } = useI18n();
  const { data, go, allowed, vehicle } = useFleet();
  const v = vehicle(job.vehicle_id);
  const money = allowed('costs.view');
  const service = lang === 'ro' ? job.service_name_ro : job.service_name_en;
  const extra = job.extra_services?.length ?? 0;
  const waiting = job.status === 'quote_sent' && job.quote?.status === 'sent';
  const approved = job.quote && job.quote.total_approved !== null && job.status !== 'quote_refused' ? job.quote.total_approved : null;
  // "Programat de …" names someone else; your own bookings need no name.
  const myUser = data.members.find((m) => m.id === data.me.member_id)?.user_id ?? null;
  const bookedBy = job.booked_by && job.booked_by === myUser ? null : job.booked_by_name || null;

  return (
    <Card className={styles.card}>
      <div className={styles.bookingHead}>
        {v ? (
          <button type="button" className={styles.bookingVehicle} onClick={() => go({ section: 'vehicul', vehicle: v.id })}>
            <span className={`mono ${styles.bookingPlate}`}>{v.plate ?? t('fleet.vehicle.noPlate')}</span>
            <span className={styles.muted}>
              {v.make} {v.model}
            </span>
          </button>
        ) : (
          <span className={styles.bookingVehicle}>
            <span className={styles.bookingPlate}>—</span>
          </span>
        )}
        <JobStagePill stage={jobStage(job)} />
      </div>
      <p className={styles.bookingService}>{extra > 0 ? t('booking.servicesMore', { first: service, n: extra }) : service}</p>
      <p className={styles.bookingMeta}>
        <span>
          <Clock size={14} aria-hidden="true" /> {formatDate(lang, job.date)}, {job.slot.slice(0, 5)}
        </span>
        <span>
          <Store size={14} aria-hidden="true" /> {job.shop_city ? `${job.shop_name}, ${job.shop_city}` : job.shop_name}
        </span>
        {bookedBy && (
          <span>
            <User size={14} aria-hidden="true" /> {t('fleet.bk.bookedBy', { name: bookedBy })}
          </span>
        )}
        <span className="mono">{job.ref}</span>
      </p>
      {money && !waiting && (approved !== null || (job.status === 'done' && job.cost !== null)) && (
        <p className={styles.bookingMoney}>
          {approved !== null && (
            <span>
              {t('fleet.quote.approved')}: <span className="mono">{formatMoney(lang, approved)}</span>
            </span>
          )}
          {job.status === 'done' && job.cost !== null && (
            <span>
              {t('fleet.quote.final')}: <span className="mono">{formatMoney(lang, job.cost)}</span>
            </span>
          )}
        </p>
      )}
      {waiting && job.quote && (
        <div className={styles.bookingDivider}>
          <FleetQuoteBody job={job} />
        </div>
      )}
    </Card>
  );
}
