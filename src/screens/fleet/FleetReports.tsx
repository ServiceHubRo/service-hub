import { ArrowDownRight, ArrowRight, ArrowUpRight, Download, FileSpreadsheet, Lock, PiggyBank, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button';
import { buttonClass } from '../../components/buttonClass';
import { Card } from '../../components/Card';
import { ChoiceFilters } from '../../components/Filters';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { LoadError } from '../../components/LoadError';
import { MoreActions } from '../../components/MoreActions';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { rpcErrorMessage, toRpcError } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { formatDate, formatDateRange, formatKm, formatMoney, formatPercent, ymdInBucharest } from '../../i18n/format';
import { plural } from '../../i18n/translate';
import { csvFormat, toCsv } from '../../lib/history';
import {
  budgetUsage,
  distinctValues,
  documentStates,
  FLEET_CATEGORIES,
  hasFeature,
  requiredPlan,
  type BudgetUsage,
  type FleetReport,
  type PerKmResult,
  type ReportFilters,
} from '../../lib/fleet';
import { saveFile } from '../../lib/saveFile';
import { toXlsxBook } from '../../lib/xlsx';
import { Meter } from '../shop/reports/Charts';
import { COST_PERIODS, periodRange, previousRange, type CostPeriod } from './periods';
import { ChartCard, NoData } from './FleetDashboard';
import { MonthBars, ShareBars } from './FleetCharts';
import { useFleet, vehicleLabel } from './fleetContext';
import { LockedFeature } from './PlanGate';
import { useFleetReport } from './useFleetReport';
import pill from '../../components/StatusBadge.module.css';
import styles from './fleet.module.css';

type ReportKey = 'totals' | 'vehicles' | 'repairs' | 'perKm' | 'budget' | 'documents' | 'trend';
const REPORT_KEYS: readonly ReportKey[] = ['totals', 'vehicles', 'repairs', 'perKm', 'budget', 'documents', 'trend'];
/** The plan feature each report needs (T65). */
const NEEDS: Partial<Record<ReportKey, 'cost_per_km' | 'reports_advanced'>> = { perKm: 'cost_per_km', trend: 'reports_advanced' };

type Period = CostPeriod | 'custom';

/** The stretch of the same length just before a range (the custom range's comparison). */
function before(range: { from: string; to: string }): { from: string; to: string } {
  const day = 86_400_000;
  const from = Date.parse(`${range.from}T12:00:00Z`);
  const to = Date.parse(`${range.to}T12:00:00Z`);
  const length = Math.round((to - from) / day) + 1;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(from - length * day), to: iso(from - day) };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rapoarte (T65): the reports the company's plan includes, computed by the database
 * (`fleet_report`) for the plan and the member's role. Fleet Business: totals, vehicles, repairs,
 * cost per km, budget, documents and a CSV of the report on screen. Fleet Pro adds the trend per
 * vehicle and against the period before, the high-cost vehicles, filters (department, vehicle type,
 * category, shop, a chosen range), the budget forecast and an Excel file of every report. What the
 * plan lacks shows its plan's name, never invented figures. Exports are checked and logged first.
 */
export function FleetReports({ initialReport }: { initialReport?: string }) {
  const { t } = useI18n();
  const { allowed, plan } = useFleet();
  if (!allowed('reports.view')) {
    return <EmptyState icon={Lock} title={t('fleet.reports.locked')} body={t('fleet.reports.lockedBody')} />;
  }
  if (!hasFeature(plan, 'reports')) {
    return <LockedFeature feature="reports" title={t('fleet.plan.lockedReports')} body={t('fleet.plan.lockedReportsBody')} />;
  }
  return <Reports initialReport={initialReport} />;
}

function Reports({ initialReport }: { initialReport?: string }) {
  const { t, lang } = useI18n();
  const { data, go, allowed, vehicle, companyPage, plan, plans, logExport } = useFleet();
  const today = ymdInBucharest(new Date());
  const advanced = hasFeature(plan, 'reports_advanced');
  const [report, setReport] = useState<ReportKey>(REPORT_KEYS.includes(initialReport as ReportKey) ? (initialReport as ReportKey) : 'totals');
  const [period, setPeriod] = useState<Period>('year');
  const [custom, setCustom] = useState({ from: `${today.slice(0, 4)}-01-01`, to: today });
  const [filters, setFilters] = useState<ReportFilters>({});
  /** An export the server refused, or a file that could not be written: said under the bar, never silent. */
  const [exportError, setExportError] = useState<string | null>(null);
  const exporting = (run: () => Promise<void>) => () => {
    setExportError(null);
    run().catch((e: unknown) => setExportError(rpcErrorMessage(lang, e)));
  };

  const customOk = YMD.test(custom.from) && YMD.test(custom.to) && custom.from <= custom.to && custom.to <= today;
  const range = period === 'custom' ? (customOk ? custom : periodRange('year', today)) : periodRange(period, today);
  const previous = period === 'custom' ? (customOk ? before(custom) : null) : previousRange(period, today);
  const request = useMemo(() => ({ range, previous, filters: advanced ? filters : {} }), [range.from, range.to, previous?.from, previous?.to, filters, advanced]); // eslint-disable-line react-hooks/exhaustive-deps
  const result = useFleetReport(request);
  const r = result.state.status === 'ready' ? result.state.data : null;

  const departments = distinctValues(data.vehicles, 'department');
  const types = distinctValues(data.vehicles, 'vehicle_type');
  const shops = r ? r.by_shop : [];
  const needs = NEEDS[report];
  const included = !needs || hasFeature(plan, needs);
  const planName = (f: 'cost_per_km' | 'reports_advanced') => {
    const p = requiredPlan(f, plans);
    return p ? (lang === 'ro' ? p.name_ro : p.name_en) : '';
  };
  const typeLabel = (v: string) => (['car', 'van', 'truck', 'motorcycle', 'other'].includes(v) ? t(`fleet.type.${v}` as 'fleet.type.car') : v);
  const setFilter = (key: keyof ReportFilters, value: string) => setFilters((f) => ({ ...f, [key]: value ? [value] : undefined }));

  // ------------------------------------------------------------------ exports
  function table(kind: ReportKey, rep: FleetReport): string[][] {
    const money = (n: number) => String(n).replace('.', csvFormat(lang).decimal);
    switch (kind) {
      case 'repairs':
        return [[t('fleet.col.vehicle'), t('fleet.reports.entries'), t('fleet.col.date'), t('fleet.col.amount')], ...rep.repairs.map((x) => [vehicleLabel(vehicle(x.vehicle_id)), String(x.count), x.last_day, money(x.total)])];
      case 'perKm':
        return [
          [t('fleet.col.vehicle'), t('fleet.col.km'), t('fleet.col.amount'), t('fleet.perKm.unit')],
          ...(rep.per_km?.per_vehicle ?? []).map((x) => [vehicleLabel(vehicle(x.vehicle_id)), x.status === 'ok' ? String(x.km) : '', x.status === 'ok' ? money(x.cost) : '', x.status === 'ok' ? money(x.per_km) : t(`fleet.perKm.reason.${x.status}`)]),
        ];
      default:
        return [[t('fleet.col.vehicle'), t('fleet.reports.entries'), t('fleet.col.amount'), t('fleet.col.category')], ...rep.by_vehicle.map((g) => [vehicleLabel(vehicle(g.key)), String(g.count), money(g.total), t(`fleet.cat.${g.top_category}` as 'fleet.cat.repairs')])];
    }
  }

  async function exportCsv(rep: FleetReport) {
    const rows = table(report, rep);
    await logExport('report_csv', rows.length - 1);
    await saveFile(new Blob([toCsv(rows, csvFormat(lang).separator)], { type: 'text/csv;charset=utf-8' }), `${t('fleet.reports.file')}-${today}.csv`);
  }

  async function exportExcel(rep: FleetReport) {
    const sheets = [
      { name: t('fleet.report.vehicles'), rows: table('vehicles', rep) },
      { name: t('fleet.chart.categories'), rows: [[t('fleet.col.category'), t('fleet.reports.entries'), t('fleet.col.amount')], ...rep.by_category.map((g) => [t(`fleet.cat.${g.key}` as 'fleet.cat.repairs'), String(g.count), String(g.total)])] },
      { name: t('fleet.reports.shopsUsed'), rows: [[t('fleet.col.vendor'), t('fleet.reports.entries'), t('fleet.col.amount')], ...rep.by_shop.map((g) => [g.name, String(g.count), String(g.total)])] },
      { name: t('fleet.report.repairs'), rows: table('repairs', rep) },
      ...(rep.per_km ? [{ name: t('fleet.report.perKm'), rows: table('perKm', rep) }] : []),
      { name: t('fleet.chart.monthly'), rows: [[t('fleet.col.date'), t('fleet.col.amount')], ...rep.monthly.map((m) => [m.month, String(m.total)])] },
    ];
    await logExport('report_xlsx', sheets.reduce((n, s) => n + s.rows.length - 1, 0));
    await saveFile(toXlsxBook(sheets), `${t('fleet.reports.file')}-${today}.xlsx`);
  }

  const exportItems = r
    ? [
        ...(hasFeature(plan, 'export_csv') ? [{ key: 'csv', label: t('fleet.export.csv'), icon: <Download size={18} aria-hidden="true" />, onSelect: exporting(() => exportCsv(r)) }] : []),
        ...(hasFeature(plan, 'export_excel') ? [{ key: 'xlsx', label: t('fleet.export.excel'), icon: <FileSpreadsheet size={18} aria-hidden="true" />, onSelect: exporting(() => exportExcel(r)) }] : []),
        { key: 'print', label: t('fleet.export.pdf'), icon: <Printer size={18} aria-hidden="true" />, onSelect: () => window.print() },
      ]
    : [];

  const periods: Period[] = advanced ? [...COST_PERIODS, 'custom'] : [...COST_PERIODS];
  const withPeriod = report !== 'documents' && report !== 'budget';

  return (
    <div className={styles.stack}>
      <div className={styles.reportBar}>
        <SelectField
          className={styles.reportSelect}
          label={t('fleet.reports.pick')}
          value={report}
          onChange={(e) => setReport(e.target.value as ReportKey)}
          options={REPORT_KEYS.map((k) => {
            const need = NEEDS[k];
            const name = t(`fleet.report.${k}`);
            return { value: k, label: need && !hasFeature(plan, need) ? `${name} · ${t('fleet.plan.availableIn', { plan: planName(need) })}` : name };
          })}
        />
        {withPeriod && included && (
          <SelectField
            className={styles.reportSelect}
            label={t('fleet.period')}
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            options={periods.map((p) => ({ value: p, label: t(`fleet.period.${p}`) }))}
          />
        )}
        {exportItems.length > 0 && included && (
          <div className={styles.reportMore}>
            <MoreActions items={exportItems} />
          </div>
        )}
      </div>

      {exportError && (
        <p className={styles.warnLine} role="alert">
          {exportError}
        </p>
      )}

      {withPeriod && included && period === 'custom' && (
        <div className={styles.twoFields}>
          <Field label={t('fleet.reports.from')} type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <Field label={t('fleet.reports.to')} type="date" value={custom.to} min={custom.from} max={today} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
        </div>
      )}

      {withPeriod && included && advanced && (
        <ChoiceFilters
          groups={[
            ...(departments.length > 0
              ? [{ key: 'department', title: t('fleet.col.department'), options: [{ value: '', label: t('fleet.vehicles.anyDepartment') }, ...departments.map((d) => ({ value: d, label: d }))], value: filters.departments?.[0] ?? '', defaultValue: '', onChange: (v: string) => setFilter('departments', v) }]
              : []),
            ...(types.length > 0
              ? [{ key: 'type', title: t('fleet.col.type'), options: [{ value: '', label: t('fleet.vehicles.anyType') }, ...types.map((v) => ({ value: v, label: typeLabel(v) }))], value: filters.vehicle_types?.[0] ?? '', defaultValue: '', onChange: (v: string) => setFilter('vehicle_types', v) }]
              : []),
            {
              key: 'category',
              title: t('fleet.col.category'),
              options: [{ value: '', label: t('fleet.costs.anyCategory') }, ...FLEET_CATEGORIES.map((c) => ({ value: c, label: t(`fleet.cat.${c}`) }))],
              value: filters.categories?.[0] ?? '',
              defaultValue: '',
              onChange: (v: string) => setFilter('categories', v),
            },
            ...(shops.length > 1 || filters.shop_ids
              ? [{ key: 'shop', title: t('fleet.bk.shop'), options: [{ value: '', label: t('fleet.costs.anyShop') }, ...shops.map((s) => ({ value: s.key, label: s.name }))], value: filters.shop_ids?.[0] ?? '', defaultValue: '', onChange: (v: string) => setFilter('shop_ids', v) }]
              : []),
          ]}
          onClearAll={() => setFilters({})}
          doneLabel={t('fleet.filters.done')}
        />
      )}
      {withPeriod && included && !advanced && (
        <p className={styles.hintLine}>
          {t('fleet.reports.filters')} <PlanTagInline feature="reports_advanced" />
        </p>
      )}

      {withPeriod && included && range.from && <p className={styles.count}>{formatDateRange(lang, range.from, range.to)}</p>}

      {!included && needs ? (
        <LockedFeature feature={needs} title={t(`fleet.report.${report}`)} body={t(`fleet.reports.locked.${report}` as 'fleet.reports.locked.trend')} />
      ) : report === 'documents' ? (
        documentsReport()
      ) : result.state.status === 'loading' ? (
        <SkeletonList cards />
      ) : result.state.status === 'error' ? (
        toRpcError(result.state.error).code === 'plan_feature_missing' ? (
          <LockedFeature feature="reports" title={t('fleet.plan.lockedReports')} body={t('fleet.plan.lockedReportsBody')} />
        ) : (
          <LoadError message={t('fleet.loadError')} onRetry={result.reload} />
        )
      ) : r ? (
        <>
          {report === 'totals' && totalsReport(r)}
          {report === 'vehicles' && vehiclesReport(r)}
          {report === 'repairs' && repairsReport(r)}
          {report === 'perKm' && perKmReport(r)}
          {report === 'budget' && budgetReport(r)}
          {report === 'trend' && trendReport(r)}
        </>
      ) : null}
    </div>
  );

  function totalsReport(rep: FleetReport) {
    const prev = rep.previous;
    const change = prev && prev.total > 0 ? (rep.total - prev.total) / prev.total : null;
    const Arrow = change === null || Math.abs(change) < 0.005 ? ArrowRight : change > 0 ? ArrowUpRight : ArrowDownRight;
    return (
      <>
        <ul className={styles.summary}>
          <li className={styles.summaryItem}>
            <span className={styles.kpiLabel}>{t('fleet.costs.total')}</span>
            <span className={`mono ${styles.summaryValue}`}>{formatMoney(lang, rep.total)}</span>
            {prev && (
              <span className={`${styles.change} ${change !== null && change > 0 ? styles.red : styles.green}`}>
                <Arrow size={14} aria-hidden="true" />
                {change === null ? t('fleet.reports.noBefore') : t('fleet.reports.vsBefore', { pct: formatPercent(lang, Math.abs(change)), amount: formatMoney(lang, prev.total) })}
              </span>
            )}
          </li>
          <li className={styles.summaryItem}>
            <span className={styles.kpiLabel}>{t('fleet.reports.entries')}</span>
            <span className={`mono ${styles.summaryValue}`}>{rep.count}</span>
          </li>
          <li className={styles.summaryItem}>
            <span className={styles.kpiLabel}>{t('fleet.kpi.avg')}</span>
            <span className={`mono ${styles.summaryValue}`}>{rep.avg_per_vehicle === null ? '—' : formatMoney(lang, rep.avg_per_vehicle)}</span>
          </li>
        </ul>
        <ChartCard title={t('fleet.chart.monthly')} hint={t('fleet.chart.monthlyHint')}>
          {rep.monthly.some((m) => m.total > 0) ? <MonthBars months={rep.monthly} currentMonth={today.slice(0, 7)} caption={t('fleet.chart.monthly')} /> : <NoData text={t('fleet.chart.noCosts')} />}
        </ChartCard>
        <ChartCard title={t('fleet.chart.categories')}>
          {rep.count > 0 ? (
            <ShareBars rows={rep.by_category.map((g) => ({ key: g.key, label: t(`fleet.cat.${g.key}` as 'fleet.cat.repairs'), value: g.total }))} />
          ) : (
            <NoData text={t('fleet.chart.noCosts')} />
          )}
        </ChartCard>
      </>
    );
  }

  function vehiclesReport(rep: FleetReport) {
    if (rep.by_vehicle.length === 0) return <NoData text={t('fleet.chart.noCosts')} />;
    const high = new Set(rep.advanced?.high_cost ?? []);
    return (
      <ChartCard title={t('fleet.report.vehicles')} hint={rep.advanced ? t('fleet.reports.highHint', { x: lang === 'ro' ? '1,5' : '1.5' }) : undefined}>
        <ShareBars
          rows={rep.by_vehicle.map((g) => ({
            key: g.key,
            label: vehicleLabel(vehicle(g.key)),
            value: g.total,
            hint: [t('fleet.reports.mostly', { cat: t(`fleet.cat.${g.top_category}` as 'fleet.cat.repairs') }), high.has(g.key) ? t('fleet.reports.high') : null].filter(Boolean).join(' · '),
            tone: high.has(g.key) ? 'red' : 'amber',
          }))}
          onPick={(id) => go({ section: 'vehicul', vehicle: id })}
        />
        {!rep.advanced && (
          <p className={styles.hintLine}>
            {t('fleet.reports.highLocked')} <PlanTagInline feature="reports_advanced" />
          </p>
        )}
      </ChartCard>
    );
  }

  function repairsReport(rep: FleetReport) {
    if (rep.repairs.length === 0) return <NoData text={t('fleet.reports.noRepairs')} />;
    return (
      <div className={styles.grid2}>
        <ChartCard title={t('fleet.reports.repairsPerVehicle')}>
          <ul className={styles.plainList}>
            {rep.repairs.map((x) => (
              <li key={x.vehicle_id}>
                <button type="button" className={styles.lineButton} onClick={() => go({ section: 'vehicul', vehicle: x.vehicle_id })}>
                  <span className={styles.lineText}>
                    <span>{vehicleLabel(vehicle(x.vehicle_id))}</span>
                    <span className={styles.muted}>
                      {plural(lang, 'unit.repairs', x.count)} · {t('fleet.reports.lastOn', { date: formatDate(lang, x.last_day) })}
                    </span>
                  </span>
                  <span className="mono">{formatMoney(lang, x.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        </ChartCard>
        <ChartCard title={t('fleet.reports.shopsUsed')}>
          <ShareBars rows={rep.by_shop.map((g) => ({ key: g.key, label: g.name, value: g.total, hint: plural(lang, 'unit.jobs', g.count) }))} />
        </ChartCard>
      </div>
    );
  }

  function perKmReport(rep: FleetReport) {
    const pk = rep.per_km;
    if (!pk) return null;
    const reason = (x: PerKmResult) => (x.status === 'ok' ? '' : t(`fleet.perKm.reason.${x.status}`));
    return (
      <>
        <Card className={styles.card}>
          <h2 className={styles.cardTitle}>{t('fleet.report.perKm')}</h2>
          {pk.total ? (
            <p className={styles.bigFigure}>
              {formatMoney(lang, pk.total.per_km)} <span className={styles.unit}>{t('fleet.perKm.unit')}</span>
            </p>
          ) : (
            <p className={styles.warnLine}>{t('fleet.perKm.none')}</p>
          )}
          <p className={styles.note}>{t('fleet.perKm.method')}</p>
        </Card>
        <Card className={styles.card}>
          <ul className={styles.plainList}>
            {pk.per_vehicle.map((x) => (
              <li key={x.vehicle_id} className={styles.lineRow}>
                <span className={styles.lineText}>
                  <span>{vehicleLabel(vehicle(x.vehicle_id))}</span>
                  <span className={styles.muted}>{x.status === 'ok' ? t('fleet.perKm.detail', { km: formatKm(lang, x.km), cost: formatMoney(lang, x.cost) }) : reason(x)}</span>
                </span>
                {x.status === 'ok' ? (
                  <span className="mono">{t('fleet.perKm.value', { amount: formatMoney(lang, x.per_km) })}</span>
                ) : (
                  <span className={`${pill.pill} ${pill.muted}`}>{t('fleet.perKm.noFigure')}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </>
    );
  }

  function budgetReport(rep: FleetReport) {
    const month = rep.budget?.monthly ? budgetUsage(rep.budget.monthly.budget, rep.budget.monthly.spent) : null;
    const year = rep.budget?.yearly ? budgetUsage(rep.budget.yearly.budget, rep.budget.yearly.spent) : null;
    const forecast = rep.forecast;
    if (!month && !year) {
      return (
        <EmptyState
          icon={PiggyBank}
          title={t('fleet.budget.emptyTitle')}
          body={allowed('budget.manage') ? t('fleet.budget.emptyBody') : t('fleet.budget.emptyBodyOther')}
          action={
            !allowed('budget.manage') ? undefined : companyPage ? (
              <Link to={companyPage} className={buttonClass('primary')}>
                {t('fleet.budget.set')}
              </Link>
            ) : (
              <Button disabled title={t('fleet.preview.notSaved')}>
                {t('fleet.budget.set')}
              </Button>
            )
          }
        />
      );
    }
    return (
      <>
        <div className={styles.grid2}>
          {budgetCard(t('fleet.budget.month'), month, forecast ? forecast.month_end : null, rep.budget?.monthly?.budget ?? null)}
          {budgetCard(t('fleet.budget.year'), year, forecast ? forecast.year_end : null, rep.budget?.yearly?.budget ?? null)}
        </div>
        {forecast ? (
          <p className={styles.hintLine}>{t('fleet.reports.forecastNote')}</p>
        ) : (
          <p className={styles.hintLine}>
            {t('fleet.reports.forecastLocked')} <PlanTagInline feature="budget_forecast" />
          </p>
        )}
      </>
    );
  }

  function budgetCard(title: string, u: BudgetUsage | null, forecast: number | null, budget: number | null) {
    return (
      <Card className={styles.card}>
        <h2 className={styles.cardTitle}>{title}</h2>
        {u ? (
          <>
            <Meter share={Math.min(1, u.used)} tone={u.over > 0 ? 'red' : u.used > 0.9 ? 'amber' : 'green'} />
            <dl className={styles.quoteTotals}>
              <div>
                <dt>{t('fleet.budget.title')}</dt>
                <dd className="mono">{formatMoney(lang, u.budget)}</dd>
              </div>
              <div>
                <dt>{t('fleet.budget.spent')}</dt>
                <dd className="mono">{formatMoney(lang, u.spent)}</dd>
              </div>
              <div>
                <dt>{u.over > 0 ? t('fleet.budget.overBy') : t('fleet.budget.remaining')}</dt>
                <dd className={`mono ${u.over > 0 ? styles.red : ''}`}>{u.over > 0 ? formatPercent(lang, u.over) : formatMoney(lang, u.remaining)}</dd>
              </div>
              {forecast !== null && (
                <div>
                  <dt>{t('fleet.reports.forecast')}</dt>
                  <dd className={`mono ${budget !== null && forecast > budget ? styles.red : ''}`}>{formatMoney(lang, forecast)}</dd>
                </div>
              )}
            </dl>
          </>
        ) : (
          <p className={styles.note}>{t('fleet.budget.notSet')}</p>
        )}
      </Card>
    );
  }

  function trendReport(rep: FleetReport) {
    const adv = rep.advanced;
    if (!adv) return null;
    if (adv.vehicle_monthly.length === 0) return <NoData text={t('fleet.chart.noCosts')} />;
    const before = new Map(adv.previous_by_vehicle.map((g) => [g.key, g.total]));
    const rows = rep.by_vehicle.map((g) => ({ key: g.key, now: g.total, before: before.get(g.key) ?? 0 }));
    return (
      <>
        {rep.previous && (
          <ChartCard title={t('fleet.reports.vsPrevious')} hint={rep.previous.from ? formatDateRange(lang, rep.previous.from, rep.previous.to) : undefined}>
            <ul className={styles.plainList}>
              {rows.map((x) => {
                const change = x.before > 0 ? (x.now - x.before) / x.before : null;
                return (
                  <li key={x.key} className={styles.lineRow}>
                    <span className={styles.lineText}>
                      <span>{vehicleLabel(vehicle(x.key))}</span>
                      <span className={styles.muted}>
                        {formatMoney(lang, x.before)} → {formatMoney(lang, x.now)}
                      </span>
                    </span>
                    <span className={`mono ${change !== null && change > 0 ? styles.red : styles.green}`}>
                      {change === null ? '—' : `${change > 0 ? '+' : '−'}${formatPercent(lang, Math.abs(change))}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </ChartCard>
        )}
        <div className={styles.grid2}>
          {adv.vehicle_monthly.map((v) => (
            <ChartCard key={v.vehicle_id} title={vehicleLabel(vehicle(v.vehicle_id))} hint={t('fleet.chart.monthlyHint')}>
              {v.months.some((m) => m.total > 0) ? (
                <MonthBars months={v.months} currentMonth={today.slice(0, 7)} caption={vehicleLabel(vehicle(v.vehicle_id))} />
              ) : (
                <NoData text={t('fleet.chart.noCosts')} />
              )}
            </ChartCard>
          ))}
        </div>
      </>
    );
  }

  function documentsReport() {
    const docs = documentStates(data.vehicles);
    if (docs.length === 0) return <NoData text={t('fleet.docs.none')} />;
    const count = (u: string) => docs.filter((d) => d.urgency === u).length;
    const attention = docs.filter((d) => d.urgency !== 'ok');
    return (
      <>
        <ul className={styles.summary}>
          {(['expired', 'soon', 'missing', 'ok'] as const).map((u) => (
            <li key={u} className={styles.summaryItem}>
              <span className={styles.kpiLabel}>{t(`fleet.docs.${u}`)}</span>
              <span className={`mono ${styles.summaryValue} ${u === 'expired' && count(u) > 0 ? styles.red : ''}`}>{count(u)}</span>
            </li>
          ))}
        </ul>
        <Card className={styles.card}>
          <h2 className={styles.cardTitle}>{t('fleet.docs.attention')}</h2>
          {attention.length === 0 ? (
            <p className={styles.note}>{t('fleet.docs.allGood')}</p>
          ) : (
            <ul className={styles.plainList}>
              {attention.map((d) => {
                const tone = d.urgency === 'expired' ? 'red' : d.urgency === 'soon' ? 'amber' : 'muted';
                return (
                  <li key={`${d.vehicle_id}-${d.doc}`}>
                    <button type="button" className={styles.lineButton} onClick={() => go({ section: 'vehicul', vehicle: d.vehicle_id })}>
                      <span className={styles.lineText}>
                        <span>
                          {t(`doc.${d.doc}`)} <span className={styles.muted}>· {vehicleLabel(vehicle(d.vehicle_id))}</span>
                        </span>
                        <span className={styles.muted}>{d.date ? formatDate(lang, d.date) : t('fleet.docs.missing')}</span>
                      </span>
                      <span className={`${pill.pill} ${pill[tone]}`}>{t(`fleet.docs.${d.urgency}`)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </>
    );
  }
}

/** The plan tag inline, after a sentence. */
function PlanTagInline({ feature }: { feature: 'reports_advanced' | 'budget_forecast' }) {
  const { t, lang } = useI18n();
  const { plans } = useFleet();
  const p = requiredPlan(feature, plans);
  if (!p) return null;
  return <span className={`${pill.pill} ${pill.amber} ${styles.planTag}`}>{t('fleet.plan.availableIn', { plan: lang === 'ro' ? p.name_ro : p.name_en })}</span>;
}
