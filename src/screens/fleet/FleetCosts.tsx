import { Download, Plus, ReceiptText } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip, ChipRow } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { SelectField } from '../../components/SelectField';
import { TextArea } from '../../components/TextArea';
import { useI18n } from '../../i18n/context';
import { formatDate, formatMoney, ymdInBucharest } from '../../i18n/format';
import { importAmount, importOdometer } from '../../lib/importRows';
import {
  buildLedger,
  costsCsv,
  filterCosts,
  FLEET_CATEGORIES,
  sumAmounts,
  totalsBy,
  type CostSource,
  type FleetCategory,
} from '../../lib/fleet';
import { saveFile } from '../../lib/saveFile';
import { SourcePill } from './FleetPills';
import { COST_PERIODS, periodRange, type CostPeriod } from './periods';
import { useFleet, vehicleLabel } from './fleetContext';
import styles from './fleet.module.css';

/**
 * Costuri (docs/FLEET_PLAN.md §5): the one ledger — Service-Hub jobs and the company's own expenses,
 * each marked with where it comes from — filtered by period, car, category, shop and source, with the
 * total of exactly what is listed and the same rows as CSV. A manual expense for a job already counted
 * and an expense in another currency are named under the list, never added.
 */
export function FleetCosts({ initialPeriod }: { initialPeriod?: string }) {
  const { t, lang } = useI18n();
  const { data, allowed, vehicle, addExpense } = useFleet();
  const today = ymdInBucharest(new Date());
  const ledger = useMemo(() => buildLedger(data.jobs, data.expenses), [data.jobs, data.expenses]);
  const [period, setPeriod] = useState<CostPeriod>(COST_PERIODS.includes(initialPeriod as CostPeriod) ? (initialPeriod as CostPeriod) : 'year');
  const [vehicleId, setVehicleId] = useState('');
  const [category, setCategory] = useState<FleetCategory | ''>('');
  const [shopId, setShopId] = useState('');
  const [source, setSource] = useState<CostSource | ''>('');
  const [adding, setAdding] = useState(false);
  const shops = useMemo(() => {
    const map = new Map<string, string>();
    for (const j of data.jobs) map.set(j.shop_id, j.shop_name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data.jobs]);

  const shown = filterCosts(ledger.entries, {
    range: periodRange(period, today),
    vehicleIds: vehicleId ? [vehicleId] : undefined,
    categories: category ? [category] : undefined,
    shopIds: shopId ? [shopId] : undefined,
    source: source || undefined,
  });
  const total = sumAmounts(shown);
  const service = sumAmounts(shown.filter((e) => e.source === 'service'));

  async function exportCsv() {
    const csv = costsCsv(shown, lang, {
      header: [t('fleet.col.date'), t('fleet.col.vehicle'), t('fleet.col.category'), t('fleet.col.source'), t('fleet.col.vendor'), t('fleet.col.km'), t('fleet.col.amount')],
      vehicle: (id) => vehicleLabel(vehicle(id)),
      category: (e) => t(`fleet.cat.${e.category}`) + (e.fee ? ` (${t('fleet.costs.fee')})` : ''),
      source: (e) => t(`fleet.source.${e.source}`),
    });
    await saveFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${t('fleet.costs.file')}-${today}.csv`);
  }

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <SelectField
          className={styles.periodSelect}
          label={t('fleet.period')}
          value={period}
          onChange={(e) => setPeriod(e.target.value as CostPeriod)}
          options={COST_PERIODS.map((p) => ({ value: p, label: t(`fleet.period.${p}`) }))}
        />
        <div className={styles.toolbarActions}>
          {allowed('costs.manage') && addExpense && (
            <Button variant="primary" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
              <Plus size={18} aria-hidden="true" /> {t('fleet.costs.add')}
            </Button>
          )}
          <Button onClick={() => void exportCsv()} disabled={shown.length === 0}>
            <Download size={18} aria-hidden="true" /> {t('fleet.export.csv')}
          </Button>
        </div>
      </div>

      {adding && <ExpenseForm onDone={() => setAdding(false)} />}

      <div className={styles.filters}>
        <SelectField
          label={t('fleet.col.vehicle')}
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          options={[{ value: '', label: t('fleet.costs.anyVehicle') }, ...data.vehicles.map((v) => ({ value: v.id, label: vehicleLabel(v) }))]}
        />
        <SelectField
          label={t('fleet.col.category')}
          value={category}
          onChange={(e) => setCategory(e.target.value as FleetCategory | '')}
          options={[{ value: '', label: t('fleet.costs.anyCategory') }, ...FLEET_CATEGORIES.map((c) => ({ value: c, label: t(`fleet.cat.${c}`) }))]}
        />
        {shops.length > 0 && (
          <SelectField
            label={t('fleet.col.shop')}
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
            options={[{ value: '', label: t('fleet.costs.anyShop') }, ...shops.map(([id, name]) => ({ value: id, label: name }))]}
          />
        )}
      </div>
      <ChipRow label={t('fleet.col.source')}>
        <Chip selected={source === ''} onClick={() => setSource('')}>
          {t('fleet.costs.allSources')}
        </Chip>
        <Chip selected={source === 'service'} onClick={() => setSource('service')}>
          {t('fleet.source.service')}
        </Chip>
        <Chip selected={source === 'manual'} onClick={() => setSource('manual')}>
          {t('fleet.source.manual')}
        </Chip>
      </ChipRow>

      <ul className={styles.summary}>
        <li className={styles.summaryItem}>
          <span className={styles.kpiLabel}>{t('fleet.costs.total')}</span>
          <span className={`mono ${styles.summaryValue}`}>{formatMoney(lang, total)}</span>
        </li>
        <li className={styles.summaryItem}>
          <span className={styles.kpiLabel}>{t('fleet.source.service')}</span>
          <span className={`mono ${styles.summaryValue}`}>{formatMoney(lang, service)}</span>
        </li>
        <li className={styles.summaryItem}>
          <span className={styles.kpiLabel}>{t('fleet.source.manual')}</span>
          <span className={`mono ${styles.summaryValue}`}>{formatMoney(lang, Math.round((total - service) * 100) / 100)}</span>
        </li>
      </ul>

      {shown.length === 0 ? (
        <EmptyState icon={ReceiptText} title={t('fleet.costs.emptyTitle')} body={ledger.entries.length === 0 ? t('fleet.costs.emptyBody') : t('fleet.costs.noMatch')} />
      ) : (
        <Card className={styles.card}>
          {!category && shown.length > 1 && (
            <p className={styles.note}>
              {totalsBy(shown, (e) => e.category)
                .slice(0, 3)
                .map((g) => `${t(`fleet.cat.${g.key}` as 'fleet.cat.repairs')} ${formatMoney(lang, g.total)}`)
                .join(' · ')}
            </p>
          )}
          <ul className={styles.plainList}>
            {shown.map((e) => (
              <li key={e.id} className={styles.lineRow}>
                <span className={styles.lineText}>
                  <span>
                    {t(`fleet.cat.${e.category}`)}
                    {e.fee ? ` · ${t('fleet.costs.fee')}` : ''}
                    <span className={styles.muted}> · {vehicleLabel(vehicle(e.vehicle_id))}</span>
                  </span>
                  <span className={styles.muted}>
                    {formatDate(lang, e.day)}
                    {e.vendor ? ` · ${e.vendor}` : ''}
                  </span>
                </span>
                <span className={styles.lineEnd}>
                  <SourcePill source={e.source} />
                  <span className="mono">{formatMoney(lang, e.amount)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(ledger.duplicates.length > 0 || ledger.foreign.length > 0) && (
        <Card className={styles.card}>
          <h2 className={styles.cardTitle}>{t('fleet.costs.notCounted')}</h2>
          <ul className={styles.plainList}>
            {ledger.duplicates.map((e) => (
              <li key={e.id} className={styles.lineRow}>
                <span className={styles.lineText}>
                  <span>
                    {t(`fleet.cat.${e.category}`)} <span className={styles.muted}>· {vehicleLabel(vehicle(e.vehicle_id))}</span>
                  </span>
                  <span className={styles.muted}>{t('fleet.costs.dupReason')}</span>
                </span>
                <span className={`mono ${styles.muted}`}>{formatMoney(lang, e.amount)}</span>
              </li>
            ))}
            {ledger.foreign.map((e) => (
              <li key={e.id} className={styles.lineRow}>
                <span className={styles.lineText}>
                  <span>
                    {t(`fleet.cat.${e.category}`)} <span className={styles.muted}>· {vehicleLabel(vehicle(e.vehicle_id))}</span>
                  </span>
                  <span className={styles.muted}>{t('fleet.costs.foreignReason')}</span>
                </span>
                <span className={`mono ${styles.muted}`}>
                  {e.amount} {e.currency}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type FormField = 'vehicle' | 'day' | 'amount' | 'odometer';

/**
 * A manual expense. The checks here mirror `fleet_add_expense` (proposed), which repeats them: a car,
 * a category, a day no later than today (Bucharest), an amount above 0, a plausible odometer.
 * Preview: the expense is kept in memory only.
 */
function ExpenseForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { data, addExpense } = useFleet();
  const today = ymdInBucharest(new Date());
  const cars = data.vehicles.filter((v) => !v.archived_at);
  const [vehicleId, setVehicleId] = useState(cars[0]?.id ?? '');
  const [category, setCategory] = useState<FleetCategory>('fuel');
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState('');
  const [supplier, setSupplier] = useState('');
  const [odometer, setOdometer] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  const dayRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const odometerRef = useRef<HTMLInputElement>(null);

  async function save() {
    const next: Partial<Record<FormField, string>> = {};
    const value = importAmount(amount);
    const km = odometer.trim() ? importOdometer(odometer) : null;
    if (!vehicleId) next.vehicle = t('fleet.form.vehicleRequired');
    if (!day || day > today) next.day = t('fleet.form.dayFuture');
    if (value === null || value <= 0) next.amount = t('fleet.form.amountInvalid');
    if (odometer.trim() && km === null) next.odometer = t('fleet.form.kmInvalid');
    setErrors(next);
    const first = (['day', 'amount', 'odometer'] as const).find((f) => next[f]);
    if (first) {
      ({ day: dayRef, amount: amountRef, odometer: odometerRef })[first].current?.focus();
      return;
    }
    if (next.vehicle) return;
    if (!addExpense) return;
    addExpense({
      id: crypto.randomUUID(),
      vehicle_id: vehicleId,
      category,
      day,
      amount: value!,
      currency: 'RON',
      description: description.trim() || null,
      supplier: supplier.trim() || null,
      odometer: km,
      booking_id: null,
      created_at: new Date().toISOString(),
      created_by: data.me.member_id,
      deleted_at: null,
    });
    onDone();
  }

  return (
    <Card className={styles.card}>
      <h2 className={styles.cardTitle}>{t('fleet.costs.add')}</h2>
      <div className={styles.formGrid}>
        <SelectField
          label={t('fleet.col.vehicle')}
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          options={cars.map((v) => ({ value: v.id, label: vehicleLabel(v) }))}
        />
        <SelectField
          label={t('fleet.col.category')}
          value={category}
          onChange={(e) => setCategory(e.target.value as FleetCategory)}
          options={FLEET_CATEGORIES.map((c) => ({ value: c, label: t(`fleet.cat.${c}`) }))}
        />
        <Field ref={dayRef} label={t('fleet.col.date')} type="date" max={today} value={day} error={errors.day} onChange={(e) => setDay(e.target.value)} />
        <Field
          ref={amountRef}
          label={t('fleet.form.amount')}
          inputMode="decimal"
          mono
          value={amount}
          error={errors.amount}
          end={<span className={styles.fieldEnd}>{t('fleet.form.currency')}</span>}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Field label={t('fleet.col.vendor')} value={supplier} maxLength={120} onChange={(e) => setSupplier(e.target.value)} />
        <Field
          ref={odometerRef}
          label={t('fleet.form.km')}
          hint={t('fleet.form.kmHint')}
          inputMode="numeric"
          mono
          value={odometer}
          error={errors.odometer}
          onChange={(e) => setOdometer(e.target.value)}
        />
      </div>
      <TextArea label={t('fleet.form.description')} value={description} maxLength={500} rows={2} onChange={(e) => setDescription(e.target.value)} />
      <p className={styles.hintLine}>{t('fleet.form.receiptLater')}</p>
      <div className={styles.actions}>
        <ActionButton variant="primary" onAction={save}>
          {t('fleet.form.save')}
        </ActionButton>
        <Button onClick={onDone}>{t('fleet.form.cancel')}</Button>
      </div>
    </Card>
  );
}
