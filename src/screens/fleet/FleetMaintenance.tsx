import { CheckCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Field } from '../../components/Field';
import type { MenuItem } from '../../components/MenuButton';
import { MoreActions } from '../../components/MoreActions';
import { SelectField } from '../../components/SelectField';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { formatDate, formatKm, ymdInBucharest } from '../../i18n/format';
import { importOdometer } from '../../lib/importRows';
import {
  jobEndDay,
  MAINTENANCE_KINDS,
  sortMaintenance,
  type FleetMaintenanceItem,
  type FleetVehicle,
  type MaintenanceKind,
  type MaintenanceStatus,
} from '../../lib/fleet';
import { useFleet } from './fleetContext';
import { useMaintenanceName } from './maintenanceName';
import pill from '../../components/StatusBadge.module.css';
import styles from './fleet.module.css';

const TONE: Record<MaintenanceStatus, string> = { ok: 'green', soon: 'amber', overdue: 'red', insufficient_data: 'muted' };

export function MaintenancePill({ status }: { status: MaintenanceStatus }) {
  const { t } = useI18n();
  return <span className={`${pill.pill} ${pill[TONE[status]]}`}>{t(`fleet.maint.status.${status}`)}</span>;
}

/**
 * „Întreținere” (M4): the vehicle's maintenance plan, each item with its status computed by the
 * database (never a false „ok”); vehicles.manage adds, edits, deletes and marks items done.
 */
export function VehicleMaintenance({ vehicle }: { vehicle: FleetVehicle }) {
  const { t, lang } = useI18n();
  const { data, allowed, mode, actions } = useFleet();
  const name = useMaintenanceName();
  const manage = mode === 'live' && !!actions && allowed('vehicles.manage');
  const [form, setForm] = useState<'new' | string | null>(null);
  const [doing, setDoing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const items = useMemo(() => sortMaintenance((data.maintenance ?? []).filter((m) => m.vehicle_id === vehicle.id)), [data.maintenance, vehicle.id]);

  return (
    <Card className={styles.card}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{t('fleet.vtab.maintenance')}</h3>
        {manage && form === null && !vehicle.archived_at && (
          <Button onClick={() => setForm('new')}>
            <Plus size={18} aria-hidden="true" /> {t('fleet.maint.add')}
          </Button>
        )}
      </div>
      {form === 'new' && <MaintenanceForm vehicle={vehicle} onDone={() => setForm(null)} />}
      {items.length === 0 ? (
        <p className={styles.note}>{t('fleet.maint.none')}</p>
      ) : (
        <ul className={styles.plainList}>
          {items.map((m) => (
            <li key={m.id} className={styles.odoRow}>
              <div className={styles.lineRow}>
                <span className={styles.lineText}>
                  <span>{name(m)}</span>
                  <span className={styles.muted}>{every(m)}</span>
                  <span className={styles.muted}>{detail(m)}</span>
                </span>
                <span className={styles.lineEnd}>
                  <MaintenancePill status={m.state.status} />
                  {manage && (
                    <MoreActions
                      items={[
                        { key: 'done', label: t('fleet.maint.markDone'), icon: <CheckCheck size={18} aria-hidden="true" />, onSelect: () => setDoing(m.id) },
                        { key: 'edit', label: t('fleet.maint.edit'), icon: <Pencil size={18} aria-hidden="true" />, onSelect: () => setForm(m.id) },
                        { key: 'delete', label: t('fleet.maint.delete'), icon: <Trash2 size={18} aria-hidden="true" />, danger: true, onSelect: () => setDeleting(m.id) },
                      ] satisfies MenuItem[]}
                    />
                  )}
                </span>
              </div>
              {form === m.id && <MaintenanceForm vehicle={vehicle} item={m} onDone={() => setForm(null)} />}
              {doing === m.id && <DoneForm item={m} onDone={() => setDoing(null)} />}
              {deleting === m.id && (
                <div className={styles.confirmPanel} role="group" aria-labelledby={`mdel-${m.id}`}>
                  <p id={`mdel-${m.id}`}>{t('fleet.maint.deleteConfirm', { name: name(m) })}</p>
                  <div className={styles.actions}>
                    <ActionButton variant="danger" onAction={(rid) => actions!.deleteMaintenance(m.id, rid)} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
                      {t('fleet.maint.deleteYes')}
                    </ActionButton>
                    <Button onClick={() => setDeleting(null)}>{t('fleet.form.cancel')}</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  function every(m: FleetMaintenanceItem): string {
    const parts = [
      m.interval_km ? formatKm(lang, m.interval_km) : null,
      m.interval_months ? t('fleet.maint.months', { n: m.interval_months }) : null,
    ].filter(Boolean);
    return `${t('fleet.maint.every')} ${parts.join(` ${t('fleet.maint.or')} `)}`;
  }

  function detail(m: FleetMaintenanceItem): string {
    const s = m.state;
    if (s.status === 'insufficient_data') return s.reasons.map((r) => t(`fleet.maint.reason.${r}`)).join(' · ');
    const parts: string[] = [];
    if (s.km_left !== null) parts.push(s.km_left < 0 ? t('fleet.maint.kmOver', { km: formatKm(lang, -s.km_left) }) : t('fleet.maint.kmLeft', { km: formatKm(lang, s.km_left) }));
    if (s.due_on) parts.push(t('fleet.maint.dueOn', { date: formatDate(lang, s.due_on) }));
    if (m.last_done_on) parts.push(t('fleet.maint.lastDone', { date: formatDate(lang, m.last_done_on) }));
    return parts.join(' · ');
  }
}

function MaintenanceForm({ vehicle, item, onDone }: { vehicle: FleetVehicle; item?: FleetMaintenanceItem; onDone: () => void }) {
  const { t, lang } = useI18n();
  const { actions } = useFleet();
  const today = ymdInBucharest(new Date());
  const [kind, setKind] = useState<MaintenanceKind>(item?.kind ?? 'oil');
  const [label, setLabel] = useState(item?.label ?? '');
  const [km, setKm] = useState(item?.interval_km ? String(item.interval_km) : '');
  const [months, setMonths] = useState(item?.interval_months ? String(item.interval_months) : '');
  const [lastOn, setLastOn] = useState(item?.last_done_on ?? '');
  const [lastKm, setLastKm] = useState(item?.last_done_km != null ? String(item.last_done_km) : '');
  const [errors, setErrors] = useState<Partial<Record<'label' | 'interval' | 'km' | 'months' | 'lastKm', string>>>({});
  const firstRef = useRef<HTMLInputElement>(null);

  async function save(requestId: string) {
    const kmV = km.trim() ? importOdometer(km) : null;
    const monthsV = months.trim() ? Number(months.trim()) : null;
    const lastKmV = lastKm.trim() ? importOdometer(lastKm) : null;
    const next: typeof errors = {};
    if (kind === 'custom' && !label.trim()) next.label = t('fleet.maint.labelRequired');
    if (!km.trim() && !months.trim()) next.interval = t('fleet.maint.intervalRequired');
    if (km.trim() && (kmV === null || kmV < 2000 || kmV > 500000)) next.km = t('fleet.maint.kmRange');
    if (months.trim() && (!Number.isInteger(monthsV) || monthsV! < 2 || monthsV! > 120)) next.months = t('fleet.maint.monthsRange');
    if (lastKm.trim() && lastKmV === null) next.lastKm = t('fleet.form.kmInvalid');
    setErrors(next);
    if (Object.keys(next).length > 0) return firstRef.current?.focus();
    await actions!.saveMaintenance(item?.id ?? null, {
      vehicle_id: vehicle.id,
      kind,
      label: kind === 'custom' ? label.trim() : null,
      interval_km: kmV,
      interval_months: monthsV,
      last_done_on: lastOn || null,
      last_done_km: lastKmV,
    }, requestId);
    onDone();
  }

  return (
    <form className={styles.inlineForm} onSubmit={(e) => e.preventDefault()} noValidate>
      <div className={styles.formGrid}>
        <SelectField
          label={t('fleet.maint.kind')}
          value={kind}
          onChange={(e) => setKind(e.target.value as MaintenanceKind)}
          options={MAINTENANCE_KINDS.map((k) => ({ value: k, label: t(`fleet.maint.kind.${k}`) }))}
        />
        {kind === 'custom' && <Field ref={firstRef} label={t('fleet.maint.label')} value={label} maxLength={80} error={errors.label} onChange={(e) => setLabel(e.target.value)} />}
        <Field label={t('fleet.maint.intervalKm')} inputMode="numeric" mono value={km} error={errors.km ?? errors.interval} onChange={(e) => setKm(e.target.value)} />
        <Field label={t('fleet.maint.intervalMonths')} inputMode="numeric" mono value={months} error={errors.months} onChange={(e) => setMonths(e.target.value)} />
        <Field label={t('fleet.maint.lastOn')} type="date" max={today} value={lastOn} onChange={(e) => setLastOn(e.target.value)} />
        <Field label={t('fleet.maint.lastKm')} inputMode="numeric" mono value={lastKm} error={errors.lastKm} onChange={(e) => setLastKm(e.target.value)} />
      </div>
      <div className={styles.actions}>
        <ActionButton submit variant="primary" onAction={save} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
          {t('fleet.maint.save')}
        </ActionButton>
        <Button onClick={onDone}>{t('fleet.form.cancel')}</Button>
      </div>
    </form>
  );
}

/** „Marchează efectuat”: a finished job of the vehicle (offered), or a day and the km. */
function DoneForm({ item, onDone }: { item: FleetMaintenanceItem; onDone: () => void }) {
  const { t, lang } = useI18n();
  const { actions, data } = useFleet();
  const today = ymdInBucharest(new Date());
  const jobs = data.jobs
    .filter((j) => j.vehicle_id === item.vehicle_id && j.status === 'done')
    .sort((a, b) => jobEndDay(b).localeCompare(jobEndDay(a)))
    .slice(0, 10);
  const [booking, setBooking] = useState('');
  const [day, setDay] = useState(today);
  const [km, setKm] = useState('');
  const [error, setError] = useState<string | undefined>();

  async function save(requestId: string) {
    if (booking) {
      await actions!.markMaintenanceDone(item.id, { booking_id: booking }, requestId);
      return onDone();
    }
    const value = km.trim() ? importOdometer(km) : null;
    if (item.interval_km && value === null) return setError(t('fleet.form.kmInvalid'));
    setError(undefined);
    await actions!.markMaintenanceDone(item.id, { day, km: value }, requestId);
    onDone();
  }

  return (
    <form className={styles.inlineForm} onSubmit={(e) => e.preventDefault()} noValidate>
      {jobs.length > 0 && (
        <SelectField
          label={t('fleet.maint.fromJob')}
          value={booking}
          onChange={(e) => setBooking(e.target.value)}
          options={[
            { value: '', label: t('fleet.maint.noJob') },
            ...jobs.map((j) => ({
              value: j.id,
              label: `${formatDate(lang, jobEndDay(j))} · ${lang === 'ro' ? j.service_name_ro : j.service_name_en} · ${j.shop_name}${j.odometer !== null ? ` · ${formatKm(lang, j.odometer)}` : ''}`,
            })),
          ]}
        />
      )}
      {!booking && (
        <div className={styles.formGrid}>
          <Field label={t('fleet.col.date')} type="date" max={today} value={day} onChange={(e) => setDay(e.target.value)} />
          <Field label={t('fleet.form.km')} inputMode="numeric" mono value={km} error={error} onChange={(e) => setKm(e.target.value)} />
        </div>
      )}
      <div className={styles.actions}>
        <ActionButton submit variant="primary" onAction={save} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
          {t('fleet.maint.markDone')}
        </ActionButton>
        <Button onClick={onDone}>{t('fleet.form.cancel')}</Button>
      </div>
    </form>
  );
}
