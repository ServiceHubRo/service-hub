import { ArrowDownRight, ArrowRight, ArrowUpRight, Download, Lock, PiggyBank, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip, ChipRow } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { SelectField } from '../../components/SelectField';
import { useI18n } from '../../i18n/context';
import { formatDate, formatDateRange, formatKm, formatMoney, formatPercent, ymdInBucharest } from '../../i18n/format';
import { plural } from '../../i18n/translate';
import {
  budgetUsage,
  buildLedger,
  costsCsv,
  documentStates,
  filterCosts,
  fleetCostPerKm,
  inRange,
  jobEndDay,
  lastMonths,
  monthlyTotals,
  sumAmounts,
  totalsBy,
  vehiclesInRange,
  type BudgetUsage,
  type CostPerKm,
} from '../../lib/fleet';
import { saveFile } from '../../lib/saveFile';
import { Meter } from '../shop/reports/Charts';
import { COST_PERIODS, periodRange, previousRange, type CostPeriod } from './periods';
import { ChartCard, NoData } from './FleetDashboard';
import { MonthBars, ShareBars } from './FleetCharts';
import { useFleet, vehicleLabel } from './fleetContext';
import pill from '../../components/StatusBadge.module.css';
import styles from './fleet.module.css';

type ReportKey = 'totals' | 'vehicles' | 'repairs' | 'perKm' | 'budget' | 'documents';
const REPORT_KEYS: readonly ReportKey[] = ['totals', 'vehicles', 'repairs', 'perKm', 'budget', 'documents'];

/** A car costs "a lot" above this multiple of the fleet's average car (cars with costs only). */
const HIGH_COST = 1.5;

/**
 * Rapoarte (docs/FLEET_PLAN.md §5): six reports over one period, every figure from the same ledger
 * as Costuri, so the two screens always agree. Exports are the period's rows as CSV and the page
 * printed (or saved as PDF from the print dialog). A report that cannot be computed says why.
 */
export function FleetReports({ initialReport }: { initialReport?: string }) {
  const { t, lang } = useI18n();
  const { data, go, allowed, vehicle } = useFleet();
  const today = ymdInBucharest(new Date());
  const [report, setReport] = useState<ReportKey>(REPORT_KEYS.includes(initialReport as ReportKey) ? (initialReport as ReportKey) : 'totals');
  const [period, setPeriod] = useState<CostPeriod>('year');
  const ledger = useMemo(() => buildLedger(data.jobs, data.expenses), [data.jobs, data.expenses]);
  const range = periodRange(period, today);
  const entries = filterCosts(ledger.entries, { range });
  const total = sumAmounts(entries);

  if (!allowed('reports.view')) {
    return <EmptyState icon={Lock} title={t('fleet.reports.locked')} body={t('fleet.reports.lockedBody')} />;
  }

  async function exportCsv() {
    const csv = costsCsv(entries, lang, {
      header: [t('fleet.col.date'), t('fleet.col.vehicle'), t('fleet.col.category'), t('fleet.col.source'), t('fleet.col.vendor'), t('fleet.col.km'), t('fleet.col.amount')],
      vehicle: (id) => vehicleLabel(vehicle(id)),
      category: (e) => t(`fleet.cat.${e.category}`),
      source: (e) => t(`fleet.source.${e.source}`),
    });
    await saveFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${t('fleet.reports.file')}-${today}.csv`);
  }

  return (
    <div className={styles.stack}>
      <ChipRow label={t('fleet.reports.pick')}>
        {REPORT_KEYS.map((k) => (
          <Chip key={k} selected={report === k} onClick={() => setReport(k)}>
            {t(`fleet.report.${k}`)}
          </Chip>
        ))}
      </ChipRow>
      <div className={styles.toolbar}>
        {report !== 'documents' && report !== 'budget' && (
          <SelectField
            className={styles.periodSelect}
            label={t('fleet.period')}
            value={period}
            onChange={(e) => setPeriod(e.target.value as CostPeriod)}
            options={COST_PERIODS.map((p) => ({ value: p, label: t(`fleet.period.${p}`) }))}
          />
        )}
        <div className={styles.toolbarActions}>
          <Button onClick={() => void exportCsv()} disabled={entries.length === 0}>
            <Download size={18} aria-hidden="true" /> {t('fleet.export.csv')}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer size={18} aria-hidden="true" /> {t('fleet.export.pdf')}
          </Button>
        </div>
      </div>
      {report !== 'documents' && report !== 'budget' && range.from && <p className={styles.count}>{formatDateRange(lang, range.from, range.to)}</p>}

      {report === 'totals' && totalsReport()}
      {report === 'vehicles' && vehiclesReport()}
      {report === 'repairs' && repairsReport()}
      {report === 'perKm' && perKmReport()}
      {report === 'budget' && budgetReport()}
      {report === 'documents' && documentsReport()}
    </div>
  );

  function totalsReport() {
    const prev = previousRange(period, today);
    const before = prev ? sumAmounts(filterCosts(ledger.entries, { range: prev })) : null;
    const change = before !== null && before > 0 ? (total - before) / before : null;
    const Arrow = change === null || Math.abs(change) < 0.005 ? ArrowRight : change > 0 ? ArrowUpRight : ArrowDownRight;
    const months = monthlyTotals(ledger.entries, lastMonths(today, 12));
    return (
      <>
        <ul className={styles.summary}>
          <li className={styles.summaryItem}>
            <span className={styles.kpiLabel}>{t('fleet.costs.total')}</span>
            <span className={`mono ${styles.summaryValue}`}>{formatMoney(lang, total)}</span>
            {prev && (
              <span className={`${styles.change} ${change !== null && change > 0 ? styles.red : styles.green}`}>
                <Arrow size={14} aria-hidden="true" />
                {change === null ? t('fleet.reports.noBefore') : t('fleet.reports.vsBefore', { pct: formatPercent(lang, Math.abs(change)), amount: formatMoney(lang, before ?? 0) })}
              </span>
            )}
          </li>
          <li className={styles.summaryItem}>
            <span className={styles.kpiLabel}>{t('fleet.reports.entries')}</span>
            <span className={`mono ${styles.summaryValue}`}>{entries.length}</span>
          </li>
          <li className={styles.summaryItem}>
            <span className={styles.kpiLabel}>{t('fleet.kpi.avg')}</span>
            <span className={`mono ${styles.summaryValue}`}>{avgText()}</span>
          </li>
        </ul>
        <ChartCard title={t('fleet.chart.monthly')} hint={t('fleet.chart.monthlyHint')}>
          {months.some((m) => m.total > 0) ? <MonthBars months={months} currentMonth={today.slice(0, 7)} caption={t('fleet.chart.monthly')} /> : <NoData text={t('fleet.chart.noCosts')} />}
        </ChartCard>
        <ChartCard title={t('fleet.chart.categories')}>
          {entries.length > 0 ? (
            <ShareBars rows={totalsBy(entries, (e) => e.category).map((g) => ({ key: g.key, label: t(`fleet.cat.${g.key}` as 'fleet.cat.repairs'), value: g.total }))} />
          ) : (
            <NoData text={t('fleet.chart.noCosts')} />
          )}
        </ChartCard>
      </>
    );
  }

  function avgText() {
    const cars = vehiclesInRange(data.vehicles, range).length;
    return cars > 0 ? formatMoney(lang, Math.round((total / cars) * 100) / 100) : '—';
  }

  function vehiclesReport() {
    const groups = totalsBy(entries, (e) => e.vehicle_id);
    if (groups.length === 0) return <NoData text={t('fleet.chart.noCosts')} />;
    const avg = sumAmounts(groups.map((g) => ({ amount: g.total }))) / groups.length;
    return (
      <ChartCard title={t('fleet.report.vehicles')} hint={t('fleet.reports.highHint', { x: String(HIGH_COST).replace('.', lang === 'ro' ? ',' : '.') })}>
        <ShareBars
          rows={groups.map((g) => {
            const top = totalsBy(
              entries.filter((e) => e.vehicle_id === g.key),
              (e) => e.category,
            )[0];
            const high = groups.length > 1 && g.total > avg * HIGH_COST;
            return {
              key: g.key,
              label: vehicleLabel(vehicle(g.key)),
              value: g.total,
              hint: [top ? t('fleet.reports.mostly', { cat: t(`fleet.cat.${top.key}` as 'fleet.cat.repairs') }) : null, high ? t('fleet.reports.high') : null].filter(Boolean).join(' · '),
              tone: high ? 'red' : 'amber',
            };
          })}
          onPick={(id) => go({ section: 'vehicul', vehicle: id })}
        />
      </ChartCard>
    );
  }

  function repairsReport() {
    const done = data.jobs.filter((j) => j.status === 'done' && inRange(jobEndDay(j), range));
    if (done.length === 0) return <NoData text={t('fleet.reports.noRepairs')} />;
    const byVehicle = new Map<string, typeof done>();
    for (const j of done) byVehicle.set(j.vehicle_id, [...(byVehicle.get(j.vehicle_id) ?? []), j]);
    const shops = totalsBy(
      entries.filter((e) => e.source === 'service'),
      (e) => e.shop_id,
    );
    return (
      <div className={styles.grid2}>
        <ChartCard title={t('fleet.reports.repairsPerVehicle')}>
          <ul className={styles.plainList}>
            {[...byVehicle.entries()]
              .sort((a, b) => b[1].length - a[1].length)
              .map(([id, list]) => (
                <li key={id}>
                  <button type="button" className={styles.lineButton} onClick={() => go({ section: 'vehicul', vehicle: id })}>
                    <span className={styles.lineText}>
                      <span>{vehicleLabel(vehicle(id))}</span>
                      <span className={styles.muted}>
                        {plural(lang, 'unit.repairs', list.length)} · {t('fleet.reports.lastOn', { date: formatDate(lang, jobEndDay(list.sort((a, b) => jobEndDay(b).localeCompare(jobEndDay(a)))[0]!)) })}
                      </span>
                    </span>
                    <span className="mono">{formatMoney(lang, sumAmounts(list.map((j) => ({ amount: j.cost ?? 0 }))))}</span>
                  </button>
                </li>
              ))}
          </ul>
        </ChartCard>
        <ChartCard title={t('fleet.reports.shopsUsed')}>
          <ShareBars
            rows={shops.map((g) => {
              const name = data.jobs.find((j) => j.shop_id === g.key)?.shop_name ?? g.key;
              return { key: g.key, label: name, value: g.total, hint: plural(lang, 'unit.jobs', g.count) };
            })}
          />
        </ChartCard>
      </div>
    );
  }

  function perKmReport() {
    const ids = data.vehicles.filter((v) => !v.archived_at).map((v) => v.id);
    const r = fleetCostPerKm(ids, data.jobs, data.expenses, ledger.entries, range);
    const reason = (x: CostPerKm) => (x.status === 'ok' ? '' : t(`fleet.perKm.reason.${x.status}`));
    return (
      <>
        <Card className={styles.card}>
          <h2 className={styles.cardTitle}>{t('fleet.report.perKm')}</h2>
          {r.total ? (
            <p className={styles.bigFigure}>
              {formatMoney(lang, r.total.perKm)} <span className={styles.unit}>{t('fleet.perKm.unit')}</span>
            </p>
          ) : (
            <p className={styles.warnLine}>{t('fleet.perKm.none')}</p>
          )}
          <p className={styles.note}>{t('fleet.perKm.method')}</p>
        </Card>
        <Card className={styles.card}>
          <ul className={styles.plainList}>
            {r.perVehicle.map(({ vehicle_id, result }) => (
              <li key={vehicle_id} className={styles.lineRow}>
                <span className={styles.lineText}>
                  <span>{vehicleLabel(vehicle(vehicle_id))}</span>
                  <span className={styles.muted}>
                    {result.status === 'ok'
                      ? t('fleet.perKm.detail', { km: formatKm(lang, result.km), cost: formatMoney(lang, result.cost) })
                      : reason(result)}
                  </span>
                </span>
                {result.status === 'ok' ? (
                  <span className="mono">{t('fleet.perKm.value', { amount: formatMoney(lang, result.perKm) })}</span>
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

  function budgetReport() {
    const month = budgetUsage(data.company.budget.monthly, sumAmounts(filterCosts(ledger.entries, { range: periodRange('month', today) })));
    const year = budgetUsage(data.company.budget.yearly, sumAmounts(filterCosts(ledger.entries, { range: periodRange('year', today) })));
    if (!month && !year) {
      return (
        <EmptyState
          icon={PiggyBank}
          title={t('fleet.budget.emptyTitle')}
          body={allowed('budget.manage') ? t('fleet.budget.emptyBody') : t('fleet.budget.emptyBodyOther')}
          action={allowed('budget.manage') ? <Button disabled title={t('fleet.preview.notSaved')}>{t('fleet.budget.set')}</Button> : undefined}
        />
      );
    }
    return (
      <div className={styles.grid2}>
        {budgetCard(t('fleet.budget.month'), month)}
        {budgetCard(t('fleet.budget.year'), year)}
      </div>
    );
  }

  function budgetCard(title: string, u: BudgetUsage | null) {
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
            </dl>
          </>
        ) : (
          <p className={styles.note}>{t('fleet.budget.notSet')}</p>
        )}
      </Card>
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
