import { Gauge, Pencil, Plus } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Field } from '../../components/Field';
import { LoadError } from '../../components/LoadError';
import type { MenuItem } from '../../components/MenuButton';
import { MoreActions } from '../../components/MoreActions';
import { SkeletonList } from '../../components/Skeleton';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { formatDate, formatDecimal, formatKm, formatMoney, ymdInBucharest } from '../../i18n/format';
import { importOdometer } from '../../lib/importRows';
import { odometerLog, type FleetVehicle, type LogEntry } from '../../lib/fleet';
import { useLoad } from '../../lib/useLoad';
import { useFleet } from './fleetContext';
import pill from '../../components/StatusBadge.module.css';
import styles from './fleet.module.css';

/**
 * „Kilometraj și consum” (M2): the vehicle's odometer log (readings and finished jobs), a reading typed
 * in (vehicles.manage, or the vehicle's driver), a correction with a reason and a job's km left out
 * (vehicles.manage), the consumption between full tanks, and the receipts the import could not take.
 */
export function VehicleOdometer({ vehicle }: { vehicle: FleetVehicle }) {
  const { t, lang } = useI18n();
  const { data, allowed, mode, actions, go } = useFleet();
  const manage = allowed('vehicles.manage');
  const canAdd = mode === 'live' && !!actions && !vehicle.archived_at && (manage || vehicle.driver_id === data.me.member_id);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const log = useMemo(
    () => odometerLog(vehicle.id, data.readings ?? [], data.jobs, data.ignored_jobs ?? []),
    [vehicle.id, data.readings, data.jobs, data.ignored_jobs],
  );
  const exceptions = (data.odometer_exceptions ?? []).filter((x) => x.vehicle_id === vehicle.id);

  return (
    <div className={styles.stack}>
      {mode === 'live' && actions && <FuelCard vehicle={vehicle} />}
      <Card className={styles.card}>
        <div className={styles.cardHead}>
          <h3 className={styles.cardTitle}>{t('fleet.odo.title')}</h3>
          {canAdd && !adding && (
            <Button onClick={() => setAdding(true)}>
              <Plus size={18} aria-hidden="true" /> {t('fleet.odo.add')}
            </Button>
          )}
        </div>
        {adding && <ReadingForm vehicle={vehicle} onDone={() => setAdding(false)} />}
        {log.length === 0 ? (
          <p className={styles.note}>{t('fleet.odo.none')}</p>
        ) : (
          <ul className={styles.plainList}>
            {log.map((e) => (
              <li key={e.key} className={styles.odoRow}>
                <div className={styles.lineRow}>
                  <span className={styles.lineText}>
                    <span className="mono">{formatKm(lang, e.km)}</span>
                    <span className={styles.muted}>
                      {formatDate(lang, e.day)} · {sourceLabel(e)}
                      {e.reading?.corrected_from != null
                        ? ` · ${t('fleet.odo.corrected', { km: formatKm(lang, e.reading.corrected_from), reason: e.reading.correction_reason ?? '' })}`
                        : ''}
                    </span>
                  </span>
                  <span className={styles.lineEnd}>
                    {e.ignored && <span className={`${pill.pill} ${pill.muted}`}>{t('fleet.odo.ignored')}</span>}
                    {e.anomaly && <span className={`${pill.pill} ${pill.amber}`}>{t('fleet.odo.anomaly')}</span>}
                    {mode === 'live' && actions && manage && <EntryActions entry={e} onCorrect={() => setEditing(e.key)} />}
                  </span>
                </div>
                {editing === e.key && e.reading && <CorrectForm entry={e} onDone={() => setEditing(null)} />}
                {editing === e.key && e.job && <IgnoreForm entry={e} onDone={() => setEditing(null)} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {manage && exceptions.length > 0 && (
        <Card className={styles.card}>
          <h3 className={styles.cardTitle}>{t('fleet.odo.exceptions')}</h3>
          <p className={styles.note}>{t('fleet.odo.exceptionsHint')}</p>
          <ul className={styles.plainList}>
            {exceptions.map((x) => (
              <li key={x.expense_id} className={styles.lineRow}>
                <span className={styles.lineText}>
                  <span className="mono">{formatKm(lang, x.km)}</span>
                  <span className={styles.muted}>
                    {formatDate(lang, x.day)} · {x.reasons.map((r) => t(`fleet.odo.reason.${r}`)).join(' · ')}
                  </span>
                </span>
                <span className={`${pill.pill} ${pill.amber}`}>{t('fleet.odo.anomaly')}</span>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button onClick={() => go({ section: 'costuri' })}>{t('fleet.odo.openCosts')}</Button>
          </div>
        </Card>
      )}
    </div>
  );

  function sourceLabel(e: LogEntry): string {
    if (e.job) return `${t('fleet.odo.src.job')} · ${e.job.shop_name}`;
    return t(`fleet.odo.src.${e.source}`);
  }
}

function EntryActions({ entry, onCorrect }: { entry: LogEntry; onCorrect: () => void }) {
  const { t } = useI18n();
  const items: MenuItem[] = [];
  if (entry.reading) items.push({ key: 'correct', label: t('fleet.odo.correct'), icon: <Pencil size={18} aria-hidden="true" />, onSelect: onCorrect });
  if (entry.job && !entry.ignored) items.push({ key: 'ignore', label: t('fleet.odo.ignore'), icon: <Gauge size={18} aria-hidden="true" />, onSelect: onCorrect });
  if (items.length === 0) return null;
  return <MoreActions items={items} />;
}

function ReadingForm({ vehicle, onDone }: { vehicle: FleetVehicle; onDone: () => void }) {
  const { t, lang } = useI18n();
  const { actions } = useFleet();
  const today = ymdInBucharest(new Date());
  const [day, setDay] = useState(today);
  const [km, setKm] = useState('');
  const [errors, setErrors] = useState<{ day?: string; km?: string }>({});
  const kmRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);

  async function save(requestId: string) {
    const value = importOdometer(km);
    const next: { day?: string; km?: string } = {};
    if (!day || day > today) next.day = t('fleet.form.dayFuture');
    if (value === null) next.km = t('fleet.form.kmInvalid');
    setErrors(next);
    if (next.day) return dayRef.current?.focus();
    if (next.km) return kmRef.current?.focus();
    await actions!.addReading(vehicle.id, day, value!, requestId);
    onDone();
  }

  return (
    <form className={styles.inlineForm} onSubmit={(e) => e.preventDefault()} noValidate>
      <div className={styles.formGrid}>
        <Field ref={dayRef} label={t('fleet.col.date')} type="date" max={today} value={day} error={errors.day} onChange={(e) => setDay(e.target.value)} />
        <Field ref={kmRef} label={t('fleet.form.km')} inputMode="numeric" mono value={km} error={errors.km} onChange={(e) => setKm(e.target.value)} />
      </div>
      <div className={styles.actions}>
        <ActionButton submit variant="primary" onAction={save} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
          {t('fleet.odo.save')}
        </ActionButton>
        <Button onClick={onDone}>{t('fleet.form.cancel')}</Button>
      </div>
    </form>
  );
}

function CorrectForm({ entry, onDone }: { entry: LogEntry; onDone: () => void }) {
  const { t, lang } = useI18n();
  const { actions } = useFleet();
  const [km, setKm] = useState(String(entry.km));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ km?: string; reason?: string }>({});

  async function save(requestId: string) {
    const value = importOdometer(km);
    const next: { km?: string; reason?: string } = {};
    if (value === null || value === entry.km) next.km = t('fleet.form.kmInvalid');
    if (reason.trim().length < 3) next.reason = t('fleet.odo.reasonShort');
    setErrors(next);
    if (next.km || next.reason) return;
    await actions!.correctReading(entry.reading!.id, value!, reason.trim(), requestId);
    onDone();
  }

  return (
    <form className={styles.inlineForm} onSubmit={(e) => e.preventDefault()} noValidate>
      <div className={styles.formGrid}>
        <Field label={t('fleet.odo.newKm')} inputMode="numeric" mono value={km} error={errors.km} onChange={(e) => setKm(e.target.value)} />
        <Field label={t('fleet.odo.reason')} value={reason} maxLength={300} error={errors.reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className={styles.actions}>
        <ActionButton submit variant="primary" onAction={save} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
          {t('fleet.odo.correctSave')}
        </ActionButton>
        <Button onClick={onDone}>{t('fleet.form.cancel')}</Button>
      </div>
    </form>
  );
}

function IgnoreForm({ entry, onDone }: { entry: LogEntry; onDone: () => void }) {
  const { t, lang } = useI18n();
  const { actions } = useFleet();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();

  async function save(requestId: string) {
    if (reason.trim().length < 3) return setError(t('fleet.odo.reasonShort'));
    setError(undefined);
    await actions!.ignoreJobOdometer(entry.job!.id, reason.trim(), requestId);
    onDone();
  }

  return (
    <form className={styles.inlineForm} role="group" aria-labelledby={`ignore-${entry.key}`} onSubmit={(e) => e.preventDefault()} noValidate>
      <p id={`ignore-${entry.key}`} className={styles.note}>
        {t('fleet.odo.ignoreConfirm', { km: formatKm(lang, entry.km) })}
      </p>
      <Field label={t('fleet.odo.reason')} value={reason} maxLength={300} error={error} onChange={(e) => setReason(e.target.value)} />
      <div className={styles.actions}>
        <ActionButton submit variant="primary" onAction={save} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
          {t('fleet.odo.ignoreSave')}
        </ActionButton>
        <Button onClick={onDone}>{t('fleet.form.cancel')}</Button>
      </div>
    </form>
  );
}

/** Consumption over the last 12 months, from the database; never an estimate. */
function FuelCard({ vehicle }: { vehicle: FleetVehicle }) {
  const { t, lang } = useI18n();
  const { actions, data } = useFleet();
  const today = ymdInBucharest(new Date());
  const from = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  // Read again whenever the company's data changes (a new fill, a corrected km).
  const stamp = `${(data.readings ?? []).length}|${data.expenses.length}|${data.expenses.reduce((m, e) => (e.updated_at && e.updated_at > m ? e.updated_at : m), '')}`;
  const load = useCallback(() => actions!.fuelStats(vehicle.id, from, today), [actions, vehicle.id, from, today, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const { state, reload } = useLoad(load);
  return (
    <Card className={styles.card}>
      <h3 className={styles.cardTitle}>{t('fleet.odo.fuel')}</h3>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('fleet.odo.fuelError')} onRetry={reload} />}
      {state.status === 'ready' && (
        <>
          {state.data.status === 'not_supported' ? (
            <p className={styles.note}>{t('fleet.odo.electric')}</p>
          ) : state.data.status === 'ok' && state.data.consumption != null ? (
            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt>{t('fleet.odo.consumption')}</dt>
                <dd className="mono">{t('fleet.odo.per100', { v: formatDecimal(lang, state.data.consumption) })}</dd>
              </div>
              {state.data.cost_per_km != null && (
                <div className={styles.fact}>
                  <dt>{t('fleet.odo.costPerKm')}</dt>
                  <dd className="mono">{formatMoney(lang, state.data.cost_per_km)}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className={styles.note}>{t('fleet.odo.noConsumption')}</p>
          )}
          {state.data.reasons.includes('missing_liters') && <p className={styles.hintLine}>{t('fleet.odo.missingLiters')}</p>}
        </>
      )}
    </Card>
  );
}
