import { CheckCheck, Download, FileText, Flag, Paperclip, Pencil, Plus, ReceiptText, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { buttonClass } from '../../components/buttonClass';
import { Card } from '../../components/Card';
import { Checkbox } from '../../components/Checkbox';
import { ChoiceFilters } from '../../components/Filters';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import type { MenuItem } from '../../components/MenuButton';
import { MoreActions } from '../../components/MoreActions';
import { SelectField } from '../../components/SelectField';
import { TextArea } from '../../components/TextArea';
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES } from '../../data/fleet';
import { canRetryRpc, rpcErrorMessage, toRpcError } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { formatDate, formatDateRange, formatMoney, ymdInBucharest } from '../../i18n/format';
import { importAmount, importOdometer } from '../../lib/importRows';
import {
  buildLedger,
  costsCsv,
  filterCosts,
  EXPENSE_CATEGORIES,
  FLEET_CATEGORIES,
  FUEL_TYPES,
  hasFeature,
  sumAmounts,
  totalsBy,
  type CostSource,
  type ExpenseCategory,
  type ExpenseFields,
  type FleetCategory,
  type FleetExpense,
  type FuelType,
} from '../../lib/fleet';
import { newRequestId } from '../../lib/requestId';
import { saveFile } from '../../lib/saveFile';
import { SourcePill } from './FleetPills';
import { COST_PERIODS, periodRange, type CostPeriod } from './periods';
import { useFleet, vehicleLabel } from './fleetContext';
import pill from '../../components/StatusBadge.module.css';
import styles from './fleet.module.css';

/**
 * Costuri (docs/FLEET_PLAN.md §5): the one ledger — Service-Hub jobs and the company's own expenses,
 * each marked with where it comes from — filtered by period, car, category, shop and source, with the
 * total of exactly what is listed and the same rows as CSV. A manual expense for a job already counted
 * and an expense in another currency are named under the list, never added.
 */
export function FleetCosts({ initialPeriod }: { initialPeriod?: string }) {
  const { t, lang } = useI18n();
  const { data, allowed, vehicle, addExpense, actions, plan, logExport } = useFleet();
  const today = ymdInBucharest(new Date());
  const ledger = useMemo(() => buildLedger(data.jobs, data.expenses), [data.jobs, data.expenses]);
  const [period, setPeriod] = useState<CostPeriod>(COST_PERIODS.includes(initialPeriod as CostPeriod) ? (initialPeriod as CostPeriod) : 'year');
  const [vehicleId, setVehicleId] = useState('');
  const [category, setCategory] = useState<FleetCategory | ''>('');
  const [shopId, setShopId] = useState('');
  const [source, setSource] = useState<CostSource | ''>('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<FleetExpense | null>(null);
  // A ledger row of an expense is `exp:<id>` (buildLedger).
  const expenseOf = (id: string) => data.expenses.find((x) => `exp:${x.id}` === id);
  const shops = useMemo(() => {
    const map = new Map<string, string>();
    for (const j of data.jobs) map.set(j.shop_id, j.shop_name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data.jobs]);

  const range = periodRange(period, today);
  const shown = filterCosts(ledger.entries, {
    range,
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
    // The plan and the role are checked, and the export logged, before the file is written (T65).
    await logExport('costs_csv', shown.length);
    await saveFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${t('fleet.costs.file')}-${today}.csv`);
  }

  return (
    <div className={styles.stack}>
      <ChoiceFilters
        groups={[
          {
            key: 'period',
            title: t('fleet.period'),
            options: COST_PERIODS.map((p) => ({ value: p, label: t(`fleet.period.${p}`) })),
            value: period,
            defaultValue: 'year',
            onChange: (v) => setPeriod(v as CostPeriod),
          },
          {
            key: 'vehicle',
            title: t('fleet.col.vehicle'),
            options: [{ value: '', label: t('fleet.costs.anyVehicle') }, ...data.vehicles.map((v) => ({ value: v.id, label: vehicleLabel(v) }))],
            value: vehicleId,
            defaultValue: '',
            onChange: setVehicleId,
          },
          {
            key: 'category',
            title: t('fleet.col.category'),
            options: [{ value: '', label: t('fleet.costs.anyCategory') }, ...FLEET_CATEGORIES.map((c) => ({ value: c, label: t(`fleet.cat.${c}`) }))],
            value: category,
            defaultValue: '',
            onChange: (v) => setCategory(v as FleetCategory | ''),
          },
          ...(shops.length > 0
            ? [
                {
                  key: 'shop',
                  title: t('fleet.col.shop'),
                  options: [{ value: '', label: t('fleet.costs.anyShop') }, ...shops.map(([id, name]) => ({ value: id, label: name }))],
                  value: shopId,
                  defaultValue: '',
                  onChange: setShopId,
                },
              ]
            : []),
          {
            key: 'source',
            title: t('fleet.col.source'),
            options: [
              { value: '', label: t('fleet.costs.allSources') },
              { value: 'service', label: t('fleet.source.service') },
              { value: 'manual', label: t('fleet.source.manual') },
            ],
            value: source,
            defaultValue: '',
            onChange: (v) => setSource(v as CostSource | ''),
          },
        ]}
        onClearAll={() => {
          setPeriod('year');
          setVehicleId('');
          setCategory('');
          setShopId('');
          setSource('');
        }}
        doneLabel={t('fleet.filters.show', { n: shown.length })}
        end={
          <div className={styles.toolbarEnd}>
            {shown.length > 0 && hasFeature(plan, 'export_csv') && (
              <ActionButton variant="ghost" block={false} className={styles.tool} onAction={() => exportCsv()} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
                <Download size={18} aria-hidden="true" /> {t('fleet.export.csv')}
              </ActionButton>
            )}
            {allowed('costs.manage') && (addExpense || actions) && (
              <Button variant="primary" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
                <Plus size={18} aria-hidden="true" /> {t('fleet.costs.add')}
              </Button>
            )}
          </div>
        }
      />
      {range.from && <p className={styles.count}>{formatDateRange(lang, range.from, range.to)}</p>}

      {adding && <ExpenseForm onDone={() => setAdding(false)} />}
      {editing && <ExpenseForm key={editing.id} expense={editing} onDone={() => setEditing(null)} />}

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
              <li key={e.id} className={`${styles.lineRow} ${e.source === 'manual' && actions ? styles.wrapRow : ''}`}>
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
                  {expenseOf(e.id)?.status === 'to_check' && <span className={`${pill.pill} ${pill.amber}`}>{t('fleet.expense.toCheck')}</span>}
                  <span className="mono">{formatMoney(lang, e.amount)}</span>
                </span>
                {e.source === 'manual' && expenseOf(e.id) && (
                  <div className={styles.rowActions}>
                    <ExpenseActions expense={expenseOf(e.id)!} onEdit={() => setEditing(expenseOf(e.id)!)} />
                  </div>
                )}
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

type FormField = 'vehicle' | 'day' | 'amount' | 'odometer' | 'liters' | 'receipt';

/**
 * An expense of the company's own (M1), new or changed. The checks mirror `fleet_save_expense`, which
 * repeats them: a vehicle, a category, a day no later than today (Bucharest), an amount above 0, a
 * plausible odometer; for fuel the liters, the fuel and whether the tank was filled. The receipt (a
 * photo or a PDF, 5 MB at most) goes to the private bucket before the expense is saved. An expense
 * identical to another one asks once more before it is saved. A driver (`fuelOnly`) adds fuel for the
 * vehicle assigned to them. Preview: kept in memory only.
 */
export function ExpenseForm({ expense, fuelOnly = false, fixedVehicle, onDone }: { expense?: FleetExpense; fuelOnly?: boolean; fixedVehicle?: string; onDone: () => void }) {
  const { t, lang } = useI18n();
  const { data, addExpense, actions } = useFleet();
  const today = ymdInBucharest(new Date());
  const cars = data.vehicles.filter((v) => !v.archived_at || v.id === expense?.vehicle_id);
  const [vehicleId, setVehicleId] = useState(expense?.vehicle_id ?? fixedVehicle ?? cars[0]?.id ?? '');
  const [category, setCategory] = useState<ExpenseCategory>(fuelOnly ? 'fuel' : ((expense?.category as ExpenseCategory | undefined) ?? 'fuel'));
  const [day, setDay] = useState(expense?.day ?? today);
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [supplier, setSupplier] = useState(expense?.supplier ?? '');
  const [odometer, setOdometer] = useState(expense?.odometer != null ? String(expense.odometer) : '');
  const [liters, setLiters] = useState(expense?.liters != null ? String(expense.liters) : '');
  const [fuelType, setFuelType] = useState<FuelType | ''>(expense?.fuel_type ?? '');
  const [fullTank, setFullTank] = useState(expense?.full_tank ?? false);
  const [description, setDescription] = useState(expense?.description ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  const dayRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const odometerRef = useRef<HTMLInputElement>(null);
  const litersRef = useRef<HTMLInputElement>(null);
  const fuel = category === 'fuel';

  function pickFile(f: File | null) {
    setErrors((e) => ({ ...e, receipt: undefined }));
    if (f && !(RECEIPT_TYPES as readonly string[]).includes(f.type)) {
      setErrors((e) => ({ ...e, receipt: t('fleet.form.receiptType') }));
      return;
    }
    if (f && f.size > RECEIPT_MAX_BYTES) {
      setErrors((e) => ({ ...e, receipt: t('fleet.form.receiptTooBig') }));
      return;
    }
    setFile(f);
  }

  async function save(requestId: string, confirmDuplicate = false) {
    const next: Partial<Record<FormField, string>> = {};
    const value = importAmount(amount);
    const km = odometer.trim() ? importOdometer(odometer) : null;
    const l = fuel && liters.trim() ? importAmount(liters) : null;
    if (!vehicleId) next.vehicle = t('fleet.form.vehicleRequired');
    if (!day || day > today) next.day = t('fleet.form.dayFuture');
    if (value === null || value <= 0) next.amount = t('fleet.form.amountInvalid');
    if (odometer.trim() && km === null) next.odometer = t('fleet.form.kmInvalid');
    if (fuel && liters.trim() && (l === null || l <= 0)) next.liters = t('fleet.form.litersInvalid');
    setErrors((e) => ({ ...next, receipt: e.receipt }));
    const first = (['day', 'amount', 'odometer', 'liters'] as const).find((f) => next[f]);
    if (first) {
      ({ day: dayRef, amount: amountRef, odometer: odometerRef, liters: litersRef })[first].current?.focus();
      return;
    }
    if (next.vehicle || errors.receipt) return;
    if (!actions) {
      // The design preview: kept in memory.
      addExpense?.({
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
      return;
    }
    const receipt = file ? await actions.uploadReceipt(vehicleId, file) : (expense?.receipt_path ?? null);
    const fields: ExpenseFields = {
      vehicle_id: vehicleId,
      category,
      day,
      amount: value!,
      supplier: supplier.trim() || null,
      description: description.trim() || null,
      odometer: km,
      liters: fuel ? l : null,
      fuel_type: fuel ? fuelType || null : null,
      full_tank: fuel ? fullTank : null,
      booking_id: expense?.booking_id ?? null,
      receipt_path: receipt,
      confirm_duplicate: confirmDuplicate,
    };
    try {
      await actions.saveExpense(expense?.id ?? null, fields, requestId);
    } catch (e) {
      if (toRpcError(e).code === 'expense_possible_duplicate') {
        // Asked once more, in the page: an identical expense is often the same receipt twice.
        setDuplicate(true);
        return;
      }
      throw e;
    }
    onDone();
  }

  const categories = fuelOnly ? (['fuel'] as const) : EXPENSE_CATEGORIES;
  return (
    <Card className={styles.card}>
      <h2 className={styles.cardTitle}>{expense ? t('fleet.costs.editTitle') : fuelOnly ? t('fleet.costs.addFuel') : t('fleet.costs.add')}</h2>
      <form className="form-contents" onSubmit={(e) => e.preventDefault()} noValidate>
        <div className={styles.formGrid}>
          {!fixedVehicle && (
            <SelectField
              label={t('fleet.col.vehicle')}
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              options={cars.map((v) => ({ value: v.id, label: vehicleLabel(v) }))}
            />
          )}
          {!fuelOnly && (
            <SelectField
              label={t('fleet.col.category')}
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              options={categories.map((c) => ({ value: c, label: t(c === 'repairs' ? 'fleet.cat.externalRepairs' : `fleet.cat.${c}`) }))}
            />
          )}
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
          {fuel && (
            <>
              <Field
                ref={litersRef}
                label={t('fleet.form.liters')}
                inputMode="decimal"
                mono
                value={liters}
                error={errors.liters}
                onChange={(e) => setLiters(e.target.value)}
              />
              <SelectField
                label={t('fleet.form.fuelType')}
                value={fuelType}
                onChange={(e) => setFuelType(e.target.value as FuelType | '')}
                options={[{ value: '', label: t('in.unset') }, ...FUEL_TYPES.map((f) => ({ value: f, label: t(`fleet.fuel.${f}`) }))]}
              />
            </>
          )}
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
        {fuel && (
          <Checkbox checked={fullTank} onChange={(e) => setFullTank(e.target.checked)}>
            {t('fleet.form.fullTank')}
          </Checkbox>
        )}
        <TextArea label={t('fleet.form.description')} value={description} maxLength={500} rows={2} onChange={(e) => setDescription(e.target.value)} />
        {actions && (
          <div className={styles.receiptField}>
            <span className={styles.receiptLabel} id="expense-receipt-label">
              {t('fleet.form.receipt')}
            </span>
            {/* The browser's own file button speaks the browser's language; this one speaks the app's. */}
            <div className={styles.receiptPick}>
              <input
                id="expense-receipt"
                type="file"
                accept={RECEIPT_TYPES.join(',')}
                className={`visually-hidden ${styles.receiptInput}`}
                aria-labelledby="expense-receipt-label"
                aria-describedby="expense-receipt-hint"
                aria-invalid={errors.receipt ? true : undefined}
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
              <label htmlFor="expense-receipt" className={buttonClass('secondary', false)}>
                <Paperclip size={18} aria-hidden="true" /> {t('fleet.form.receiptPick')}
              </label>
              <span className={styles.receiptName}>{file ? file.name : expense?.receipt_path ? t('fleet.form.receiptAttached') : t('fleet.form.receiptNone')}</span>
            </div>
            <p id="expense-receipt-hint" className={errors.receipt ? styles.fieldErrorLine : styles.hintLine}>
              {errors.receipt ?? (expense?.receipt_path && !file ? t('fleet.form.receiptKept') : t('fleet.form.receiptHint'))}
            </p>
          </div>
        )}
        {duplicate ? (
          <div className={styles.confirmPanel} role="group" aria-labelledby="expense-dup">
            <p id="expense-dup">{t('rpcError.expense_possible_duplicate')}</p>
            <div className={styles.actions}>
              <ActionButton variant="primary" onAction={(rid) => save(rid, true)} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
                {t('fleet.form.saveAnyway')}
              </ActionButton>
              <Button onClick={() => setDuplicate(false)}>{t('fleet.form.cancel')}</Button>
            </div>
          </div>
        ) : (
          <div className={styles.actions}>
            <ActionButton submit variant="primary" onAction={(rid) => save(rid)} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
              {t('fleet.form.save')}
            </ActionButton>
            <Button onClick={onDone}>{t('fleet.form.cancel')}</Button>
          </div>
        )}
      </form>
    </Card>
  );
}

/** „Mai multe” on an expense of the company's own: edit, the receipt, checked or not, delete. */
function ExpenseActions({ expense, onEdit }: { expense: FleetExpense; onEdit: () => void }) {
  const { t, lang } = useI18n();
  const { actions, allowed } = useFleet();
  const [confirm, setConfirm] = useState(false);
  if (!actions) return null;
  const items: MenuItem[] = [];
  if (allowed('costs.manage')) items.push({ key: 'edit', label: t('fleet.expense.edit'), icon: <Pencil size={18} aria-hidden="true" />, onSelect: onEdit });
  if (expense.receipt_path) {
    items.push({
      key: 'receipt',
      label: t('fleet.expense.viewReceipt'),
      icon: <FileText size={18} aria-hidden="true" />,
      onSelect: () => {
        // Opened at once (a browser blocks a window opened after a wait), then pointed at the file.
        const win = window.open('', '_blank');
        void actions.receiptUrl(expense.receipt_path!).then(
          (url) => {
            if (win) win.location.href = url;
          },
          () => win?.close(),
        );
      },
    });
  }
  if (allowed('costs.manage')) {
    items.push(
      expense.status === 'to_check'
        ? { key: 'ok', label: t('fleet.expense.markOk'), icon: <CheckCheck size={18} aria-hidden="true" />, onSelect: () => void actions.markExpense(expense.id, 'ok', newRequestId()) }
        : { key: 'check', label: t('fleet.expense.markToCheck'), icon: <Flag size={18} aria-hidden="true" />, onSelect: () => void actions.markExpense(expense.id, 'to_check', newRequestId()) },
      { key: 'delete', label: t('fleet.expense.delete'), icon: <Trash2 size={18} aria-hidden="true" />, danger: true, onSelect: () => setConfirm(true) },
    );
  }
  return (
    <>
      <MoreActions items={items} />
      {confirm && (
        <div className={styles.confirmPanel} role="group" aria-labelledby={`del-${expense.id}`}>
          <p id={`del-${expense.id}`}>{t('fleet.expense.deleteConfirm')}</p>
          <div className={styles.actions}>
            <ActionButton variant="danger" onAction={(rid) => actions.deleteExpense(expense.id, rid)} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
              {t('fleet.expense.deleteYes')}
            </ActionButton>
            <Button onClick={() => setConfirm(false)}>{t('fleet.form.cancel')}</Button>
          </div>
        </div>
      )}
    </>
  );
}
