import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  Car,
  CarFront,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  Gauge,
  PiggyBank,
  Plus,
  Receipt,
  Wallet,
  Wrench,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { useI18n } from '../../i18n/context';
import { formatDate, formatKm, formatMoney, formatPercent, formatRelativeDays, ymdInBucharest } from '../../i18n/format';
import {
  documentStates,
  maintenanceDue,
  fleetKpis,
  hasFeature,
  recentActivity,
  yearRange,
  type Activity,
  type ActivityKind,
  type BudgetUsage,
} from '../../lib/fleet';
import { MonthBars, ShareBars } from './FleetCharts';
import { useFleet, vehicleLabel, type FleetLink } from './fleetContext';
import { LockedFeature } from './PlanGate';
import { useFleetReport } from './useFleetReport';
import pill from '../../components/StatusBadge.module.css';
import { MaintenancePill } from './FleetMaintenance';
import { useMaintenanceName } from './maintenanceName';
import styles from './fleet.module.css';

const ACTIVITY_ICON: Record<ActivityKind, LucideIcon> = {
  booking_created: CalendarClock,
  quote_received: Receipt,
  quote_approved: CheckCircle2,
  quote_refused: XCircle,
  job_done: Wrench,
  expense_added: Wallet,
  vehicle_added: Car,
  issue_reported: AlertTriangle,
};

/**
 * Panou flotei (docs/FLEET_PLAN.md §4): the headline figures, each opening the page it summarizes,
 * then the charts that have enough data and the recent activity. Money never appears for a role that
 * may not see it (the read holds none), and a chart without data says why instead of drawing zeros.
 */
export function FleetDashboard() {
  const maintenanceName = useMaintenanceName();
  const { t, lang } = useI18n();
  const { data, go, allowed, vehicle, plan } = useFleet();
  const now = useMemo(() => new Date(), []);
  const today = ymdInBucharest(now);
  const k = useMemo(() => fleetKpis(data, now), [data, now]);
  const activity = useMemo(() => recentActivity(data), [data]);
  const money = allowed('costs.view');
  // Fleet Business and up (T65): the financial part, computed by the database for the plan and role.
  const finance = money && hasFeature(plan, 'dashboard_finance');
  const report = useFleetReport(finance && allowed('reports.view') ? { range: yearRange(today), previous: null, filters: {} } : null);

  if (data.vehicles.length === 0) {
    return (
      <EmptyState
        icon={CarFront}
        title={t('fleet.empty.title')}
        body={allowed('vehicles.manage') ? t('fleet.empty.body') : t('fleet.empty.bodyDriver')}
        action={
          allowed('vehicles.manage') ? (
            <Button variant="primary" onClick={() => go({ section: 'vehicule', filter: 'nou' })}>
              <Plus size={18} aria-hidden="true" /> {t('fleet.vehicles.add')}
            </Button>
          ) : undefined
        }
      />
    );
  }

  const money0 = (n: number | null) => (n === null ? '—' : formatMoney(lang, n));
  const r = report.state.status === 'ready' ? report.state.data : null;
  const months = r?.monthly ?? [];
  const anyMonth = months.some((m) => m.total > 0);
  const deadlines = documentStates(data.vehicles, now).filter((d) => d.urgency === 'expired' || d.urgency === 'soon').slice(0, 5);
  // M4: maintenance due soon or overdue, next to the documents.
  const maintenance = maintenanceDue(data.maintenance ?? []).slice(0, 5);

  return (
    <div className={styles.stack}>
      <ul className={styles.kpis} aria-label={t('fleet.kpi.label')}>
        {kpi({ icon: CarFront, label: allowed('vehicles.viewAll') ? t('fleet.kpi.vehicles') : t('fleet.kpi.myVehicles'), value: String(k.vehicles), link: { section: 'vehicule' } })}
        {kpi({ icon: CheckCircle2, label: t('fleet.kpi.active'), value: String(k.active), link: { section: 'vehicule', filter: 'active' } })}
        {kpi({ icon: Wrench, label: t('fleet.kpi.inService'), value: String(k.inService), link: { section: 'vehicule', filter: 'in_service' }, tone: k.inService > 0 ? 'amber' : undefined })}
        {kpi({ icon: CalendarClock, label: t('fleet.kpi.upcoming'), value: String(k.upcoming), link: { section: 'programari', filter: 'active' } })}
        {(allowed('quotes.approve') || money) &&
          kpi({ icon: ClipboardCheck, label: t('fleet.kpi.quotes'), value: String(k.quotesWaiting), link: { section: 'programari', filter: 'approve' }, tone: k.quotesWaiting > 0 ? 'amber' : undefined })}
        {kpi({ icon: FileWarning, label: t('fleet.kpi.docs'), value: String(k.docsExpiring), link: { section: allowed('reports.view') && hasFeature(plan, 'reports') ? 'rapoarte' : 'vehicule', filter: 'documents' }, tone: k.docsExpiring > 0 ? 'red' : undefined })}
        {money && kpi({ icon: Wallet, label: t('fleet.kpi.month'), value: money0(k.monthSpend), link: { section: 'costuri', filter: 'month' }, wide: true })}
        {finance && (
          <>
            {kpi({ icon: BarChart3, label: t('fleet.kpi.year'), value: r ? money0(r.total) : '…', link: { section: 'costuri', filter: 'year' }, wide: true })}
            {kpi({ icon: Gauge, label: t('fleet.kpi.avg'), value: r ? money0(r.avg_per_vehicle) : '…', hint: t('fleet.kpi.avgHint'), link: { section: 'rapoarte', filter: 'vehicles' }, wide: true })}
            {budgetKpi(k.monthBudget, allowed('budget.manage'))}
          </>
        )}
      </ul>

      <Card className={styles.card}>
        <h2 className={styles.cardTitle}>{t('fleet.deadlines.title')}</h2>
        {deadlines.length === 0 && maintenance.length === 0 ? (
          <p className={styles.note}>{t('fleet.docs.allGood')}</p>
        ) : (
          <ul className={styles.plainList}>
            {deadlines.map((d) => (
              <li key={`${d.vehicle_id}:${d.doc}`}>
                <button type="button" className={styles.lineButton} onClick={() => go({ section: 'vehicul', vehicle: d.vehicle_id })}>
                  <span className={styles.lineText}>
                    <span>
                      {t(`doc.${d.doc}`)} · {vehicleLabel(vehicle(d.vehicle_id))}
                    </span>
                    <span className={styles.muted}>{d.date ? formatDate(lang, d.date) : ''}</span>
                  </span>
                  <span className={`${pill.pill} ${pill[d.urgency === 'expired' ? 'red' : 'amber']}`}>{t(`fleet.docs.${d.urgency}`)}</span>
                </button>
              </li>
            ))}
            {maintenance.map((m) => (
              <li key={`m:${m.id}`}>
                <button type="button" className={styles.lineButton} onClick={() => go({ section: 'vehicul', vehicle: m.vehicle_id })}>
                  <span className={styles.lineText}>
                    <span>
                      {maintenanceName(m)} · {vehicleLabel(vehicle(m.vehicle_id))}
                    </span>
                    <span className={styles.muted}>{m.state.due_on ? formatDate(lang, m.state.due_on) : ''}</span>
                  </span>
                  <MaintenancePill status={m.state.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {money && !finance && <LockedFeature feature="dashboard_finance" title={t('fleet.plan.lockedFinance')} body={t('fleet.plan.lockedFinanceBody')} />}

      {finance && report.state.status === 'error' && <LoadError message={t('fleet.loadError')} onRetry={report.reload} />}
      {finance && report.state.status === 'loading' && <SkeletonList cards />}
      {finance && r && (
        <div className={styles.grid2}>
          <ChartCard title={t('fleet.chart.monthly')} hint={t('fleet.chart.monthlyHint')}>
            {anyMonth ? (
              <MonthBars months={months} currentMonth={today.slice(0, 7)} budget={data.company.budget.monthly} caption={t('fleet.chart.monthly')} />
            ) : (
              <NoData text={t('fleet.chart.noCosts')} />
            )}
            {data.company.budget.monthly !== null && anyMonth && <p className={styles.legend}><span className={styles.legendDash} aria-hidden="true" /> {t('fleet.chart.budgetLine', { amount: formatMoney(lang, data.company.budget.monthly) })}</p>}
          </ChartCard>

          <ChartCard title={t('fleet.chart.categories')} hint={t('fleet.chart.yearHint')}>
            {r.count > 0 ? (
              <ShareBars rows={r.by_category.map((g) => ({ key: g.key, label: t(`fleet.cat.${g.key}` as 'fleet.cat.repairs'), value: g.total }))} />
            ) : (
              <NoData text={t('fleet.chart.noCosts')} />
            )}
          </ChartCard>

          <ChartCard title={t('fleet.chart.vehicles')} hint={t('fleet.chart.yearHint')}>
            {r.count > 0 ? (
              <ShareBars
                rows={r.by_vehicle.map((g) => ({ key: g.key, label: vehicleLabel(vehicle(g.key)), value: g.total }))}
                onPick={(id) => go({ section: 'vehicul', vehicle: id })}
              />
            ) : (
              <NoData text={t('fleet.chart.noCosts')} />
            )}
          </ChartCard>

          <ChartCard title={t('fleet.chart.perKm')} hint={t('fleet.chart.yearHint')}>
            {r.per_km?.total ? (
              <>
                <p className={styles.bigFigure}>
                  {formatMoney(lang, r.per_km.total.per_km)} <span className={styles.unit}>{t('fleet.perKm.unit')}</span>
                </p>
                <p className={styles.note}>
                  {t('fleet.perKm.basis', {
                    cars: r.per_km.per_vehicle.filter((p) => p.status === 'ok').length,
                    total: r.per_km.per_vehicle.length,
                    km: formatKm(lang, r.per_km.total.km),
                  })}
                </p>
                <Button variant="ghost" onClick={() => go({ section: 'rapoarte', filter: 'perKm' })}>
                  {t('fleet.perKm.open')}
                </Button>
              </>
            ) : (
              <NoData text={t('fleet.perKm.none')} />
            )}
          </ChartCard>
        </div>
      )}

      <Card className={styles.card}>
        <h2 className={styles.cardTitle}>{t('fleet.activity.title')}</h2>
        {activity.length === 0 ? (
          <p className={styles.note}>{t('fleet.activity.none')}</p>
        ) : (
          <ul className={styles.activity}>
            {activity.map((a) => (
              activityRow(a, now)
            ))}
          </ul>
        )}
      </Card>
    </div>
  );

  function activityRow(a: Activity, at: Date) {
    const Icon = ACTIVITY_ICON[a.kind];
    const v = vehicle(a.vehicle_id);
    return (
      <li key={a.id}>
        <button type="button" className={styles.activityRow} onClick={() => go({ section: 'vehicul', vehicle: a.vehicle_id })}>
          <span className={`${styles.activityIcon} ${styles[`tone_${a.kind}`] ?? ''}`} aria-hidden="true">
            <Icon size={16} />
          </span>
          <span className={styles.activityText}>
            <span className={styles.activityTitle}>{t(`fleet.activity.${a.kind}`)}</span>
            <span className={styles.activityMeta}>
              {vehicleLabel(v)}
              {a.detail ? ` · ${a.detail}` : ''}
            </span>
          </span>
          <span className={styles.activityEnd}>
            {a.amount !== null && <span className="mono">{formatMoney(lang, a.amount)}</span>}
            <span className={styles.muted}>{formatRelativeDays(lang, new Date(a.at), at)}</span>
          </span>
        </button>
      </li>
    );
  }

  function kpi({ icon: Icon, label, value, hint, link, tone, wide }: { icon: LucideIcon; label: string; value: string; hint?: string; link?: FleetLink; tone?: 'amber' | 'red'; wide?: boolean }) {
    const body = (
      <>
        <span className={`${styles.kpiIcon} ${tone ? styles[`kpi_${tone}`] : ''}`} aria-hidden="true">
          <Icon size={18} />
        </span>
        <span className={styles.kpiLabel}>{label}</span>
        <span className={`mono ${styles.kpiValue}`}>{value}</span>
        {hint && <span className={styles.kpiHint}>{hint}</span>}
      </>
    );
    return (
      <li className={wide ? styles.kpiWide : undefined}>
        {link ? (
          <button type="button" className={styles.kpi} onClick={() => go(link)}>
            {body}
          </button>
        ) : (
          <div className={styles.kpi}>{body}</div>
        )}
      </li>
    );
  }

  function budgetKpi(usage: BudgetUsage | null, canSet: boolean) {
    if (!usage) {
      return (
        <li className={styles.kpiWide}>
          <button type="button" className={styles.kpi} onClick={() => go({ section: 'rapoarte', filter: 'budget' })}>
            <span className={styles.kpiIcon} aria-hidden="true">
              <PiggyBank size={18} />
            </span>
            <span className={styles.kpiLabel}>{t('fleet.kpi.budget')}</span>
            <span className={styles.kpiEmpty}>{canSet ? t('fleet.budget.setCta') : t('fleet.budget.notSet')}</span>
          </button>
        </li>
      );
    }
    const over = usage.over > 0;
    return (
      <li className={styles.kpiWide}>
        <button type="button" className={styles.kpi} onClick={() => go({ section: 'rapoarte', filter: 'budget' })}>
          <span className={`${styles.kpiIcon} ${over ? styles.kpi_red : ''}`} aria-hidden="true">
            <PiggyBank size={18} />
          </span>
          <span className={styles.kpiLabel}>{t('fleet.kpi.budget')}</span>
          <span className={`mono ${styles.kpiValue} ${over ? styles.red : ''}`}>{formatPercent(lang, usage.used)}</span>
          <span className={styles.kpiHint}>
            {over ? t('fleet.budget.over', { pct: formatPercent(lang, usage.over) }) : t('fleet.budget.left', { amount: formatMoney(lang, usage.remaining) })}
          </span>
        </button>
      </li>
    );
  }
}

export function ChartCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{title}</h2>
        {hint && <span className={styles.cardHint}>{hint}</span>}
      </div>
      {children}
    </Card>
  );
}

export function NoData({ text }: { text: string }) {
  return (
    <div className={styles.noData}>
      <BarChart3 size={22} aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}
