import { ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Download, Lock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BackLink } from '../../../components/BackLink';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Chip, ChipRow } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { subscribeRows } from '../../../data/realtime';
import { fetchShopReports } from '../../../data/shopReports';
import { useI18n, type I18nValue } from '../../../i18n/context';
import {
  formatDateRange,
  formatDecimal,
  formatMoney,
  formatPercent,
  formatWeekday,
  ymdInBucharest,
} from '../../../i18n/format';
import { plural, type Lang } from '../../../i18n/translate';
import { csvAmount, csvFormat, toCsv } from '../../../lib/history';
import {
  byService,
  change,
  csvJobs,
  customers,
  doneCount,
  duration,
  headline,
  isReportPeriod,
  jobDay,
  LOW_ACCEPTANCE,
  MIN_JOBS,
  monthlyRevenue,
  periodRange,
  previousRange,
  quoteStats,
  REPORT_PERIODS,
  utilization,
  type Change,
  type DayRange,
  type ReportData,
  type ReportJob,
  type ReportPeriod,
} from '../../../lib/shopReports';
import { useLoad } from '../../../lib/useLoad';
import { useNow } from '../../../lib/useNow';
import { MonthlyChart, Meter, ServiceBars } from './Charts';
import { ACCOUNT_PATH } from '../paths';
import styles from './reports.module.css';

/** Room for more work below this share of the capacity; nearly full above the other (P22). */
const UTILIZATION_LOW = 0.5;
const UTILIZATION_HIGH = 0.9;

/**
 * Rapoarte (FR §4.9, P22): the owner's tile in Cont. A period (in the address, `?perioada=`), the
 * three headline figures against the period before, revenue by month, jobs by service, customers
 * and how many came back, quotes, utilization, and the period as CSV. The database answers the rows
 * once; every figure is summed here (src/lib/shopReports.ts), so a chip never reloads or jumps. Live:
 * a job finished on another device shows up without a reload.
 */
export function ShopReportsScreen() {
  const { t } = useI18n();
  const { state, reload, setData } = useLoad(fetchShopReports);

  // Quiet re-read on every change of the shop's bookings; several in a row cost one read, and an
  // older answer never replaces a newer one.
  const shopId = state.status === 'ready' ? (state.data?.shop.id ?? null) : null;
  const generation = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++generation.current;
    fetchShopReports().then(
      (data) => {
        if (mine === generation.current) setData(data);
      },
      () => {}, // the figures on screen stay; the next change or reconnect reads again
    );
  }, [setData]);
  useEffect(() => {
    if (!shopId) return;
    let timer: number | undefined;
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 300);
    };
    const unsubscribe = subscribeRows({
      channel: `shop-reports:${shopId}`,
      table: 'bookings',
      filter: `shop_id=eq.${shopId}`,
      onChange: later,
      onResync: later,
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [shopId, refresh]);

  let body;
  if (state.status === 'loading') body = <SkeletonList />;
  else if (state.status === 'error') body = <LoadError message={t('rep.loadError')} onRetry={reload} />;
  else if (!state.data) body = <EmptyState icon={Lock} title={t('rep.ownerOnly')} body={t('rep.ownerOnlyBody')} />;
  else if (doneCount(state.data.jobs) < MIN_JOBS) body = <EmptyState icon={BarChart3} title={t('rep.emptyTitle')} body={t('rep.empty')} />;
  else body = <Reports data={state.data} />;

  return (
    <div className={styles.page}>
      <BackLink to={ACCOUNT_PATH} label={t('nav.account')} />
      <h1>{t('rep.title')}</h1>
      {body}
    </div>
  );
}

function Reports({ data }: { data: ReportData }) {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const periodParam = params.get('perioada');
  const period = isReportPeriod(periodParam) ? periodParam : 'month';
  const now = useNow();
  const today = ymdInBucharest(now);

  const figures = useMemo(() => {
    const range = periodRange(period, today);
    const before = previousRange(period, today);
    const current = headline(data.jobs, range);
    const previous = before ? headline(data.jobs, before) : null;
    return {
      range,
      before,
      current,
      previous,
      months: monthlyRevenue(data.jobs, today),
      services: byService(data.jobs, range),
      customers: customers(data.jobs, range),
      quotes: quoteStats(data.quotes, data.jobs, range),
      utilization: utilization(data, range),
    };
  }, [data, period, today]);

  const { range, before, current, previous, quotes, utilization: use } = figures;
  const setPeriod = (p: ReportPeriod) => {
    const next = new URLSearchParams(window.location.search);
    if (p === 'month') next.delete('perioada');
    else next.set('perioada', p);
    setParams(next, { replace: true });
  };

  return (
    <>
      <ChipRow label={t('rep.period.label')}>
        {REPORT_PERIODS.map((p) => (
          <Chip key={p} selected={period === p} onClick={() => setPeriod(p)}>
            {t(`rep.period.${p}`)}
          </Chip>
        ))}
      </ChipRow>

      <section>
        <ul className={styles.stats}>
          <li className={`${styles.stat} ${styles.wide}`}>
            <span className={`${styles.statNumber} ${styles.green}`}>{formatAmount(lang, current.revenue)}</span>
            <span className={styles.statLabel}>{t('rep.revenueUnit')}</span>
            {previous && <ChangeLine change={change(current.revenue, previous.revenue)} />}
          </li>
          <li className={styles.stat}>
            <span className={styles.statNumber}>{current.jobs}</span>
            <span className={styles.statLabel}>{t('rep.jobs')}</span>
            {previous && <ChangeLine change={change(current.jobs, previous.jobs)} />}
          </li>
          <li className={styles.stat}>
            <span className={`${styles.statNumber} ${styles.amber}`}>
              {current.average === null ? '—' : formatAmount(lang, current.average)}
            </span>
            <span className={styles.statLabel}>{t('rep.averageUnit')}</span>
            {previous && current.average !== null && <ChangeLine change={change(current.average, previous.average)} />}
          </li>
        </ul>
        {before && before.from && (
          <p className={styles.compare}>{t('rep.compare', { range: formatDateRange(lang, before.from, before.to, now) })}</p>
        )}
      </section>

      <Section title={t('rep.byMonth')} hint={t('rep.byMonth.hint')}>
        {figures.months.some((m) => m.revenue > 0) ? (
          <MonthlyChart months={figures.months} currentMonth={today.slice(0, 7)} />
        ) : (
          <p className={styles.muted}>{t('rep.byMonth.none')}</p>
        )}
      </Section>

      <Section title={t('rep.byService')}>
        {figures.services.length > 0 ? <ServiceBars rows={figures.services} /> : <p className={styles.muted}>{t('rep.byService.none')}</p>}
      </Section>

      <Section title={t('rep.customers')}>
        <dl className={styles.rows}>
          <Row label={t('rep.unique')} value={String(figures.customers.unique)} />
          <div className={styles.row}>
            <dt>
              {t('rep.returning')}
              <span className={styles.rowHint}>{t('rep.returning.hint')}</span>
            </dt>
            <dd className={`mono ${styles.highlight}`}>
              {figures.customers.returning}
              {figures.customers.returningShare !== null && ` · ${formatPercent(lang, figures.customers.returningShare)}`}
            </dd>
          </div>
          <Row
            label={t('rep.perCustomer')}
            value={figures.customers.jobsPerCustomer === null ? '—' : formatDecimal(lang, figures.customers.jobsPerCustomer)}
          />
        </dl>
      </Section>

      <Section title={t('rep.quotes')}>
        {quotes.decided === 0 ? (
          <p className={styles.muted}>{t('rep.quotes.none')}</p>
        ) : (
          <>
            <div className={styles.meterBlock}>
              <div className={styles.row}>
                <span className={styles.label}>
                  {t('rep.acceptance')}
                  <span className={styles.rowHint}>
                    {t('rep.acceptance.detail', { accepted: quotes.accepted, decided: quotes.decided })}
                  </span>
                </span>
                <span className={`mono ${styles.big} ${quotes.rate! < LOW_ACCEPTANCE ? styles.red : styles.green}`}>
                  {formatPercent(lang, quotes.rate!)}
                </span>
              </div>
              <Meter share={quotes.rate!} tone={quotes.rate! < LOW_ACCEPTANCE ? 'red' : 'green'} />
              {quotes.rate! < LOW_ACCEPTANCE && <p className={styles.note}>{t('rep.acceptance.low')}</p>}
            </div>
            <dl className={styles.rows}>
              <div className={styles.row}>
                <dt>
                  {t('rep.refused')}
                  <span className={styles.rowHint}>{t('rep.refused.hint')}</span>
                </dt>
                <dd className="mono">{quotes.refused}</dd>
              </div>
              <Row label={t('rep.fees')} value={formatMoney(lang, quotes.fees)} />
              <Row
                label={t('rep.response')}
                value={quotes.averageResponseMs === null ? '—' : formatDuration(lang, quotes.averageResponseMs)}
              />
            </dl>
          </>
        )}
      </Section>

      <Section title={t('rep.utilization')}>
        {use.share === null || use.perDay === null ? (
          <p className={styles.muted}>{t('rep.utilization.none')}</p>
        ) : (
          <>
            <div className={styles.meterBlock}>
              <div className={styles.row}>
                <span className={styles.label}>
                  {t('rep.utilization.share')}
                  <span className={styles.rowHint}>
                    {t('rep.utilization.perDay', { cars: formatDecimal(lang, use.perDay), capacity: use.capacity })}
                  </span>
                  <span className={styles.rowHint}>
                    {t('rep.utilization.over', { days: plural(lang, 'unit.days', use.openDays) })}
                  </span>
                </span>
                <span className={`mono ${styles.big}`}>{formatPercent(lang, use.share)}</span>
              </div>
              <Meter share={use.share} tone="blue" />
              {use.share < UTILIZATION_LOW && <p className={styles.note}>{t('rep.utilization.low')}</p>}
              {use.share >= UTILIZATION_HIGH && <p className={styles.note}>{t('rep.utilization.high')}</p>}
            </div>
            {use.busiestWeekday !== null && (
              <dl className={styles.rows}>
                <Row label={t('rep.busiest')} value={formatWeekday(lang, use.busiestWeekday)} plain />
              </dl>
            )}
          </>
        )}
      </Section>

      <div>
        <Button variant="ghost" className={styles.download} onClick={() => downloadCsv(data.jobs, range, period, lang, t, today)}>
          <Download size={18} aria-hidden="true" />
          {t('rep.download')}
        </Button>
      </div>
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        {title}
        {hint && <span className={styles.headingHint}>{hint}</span>}
      </h2>
      <Card className={styles.card}>{children}</Card>
    </section>
  );
}

function Row({ label, value, plain = false }: { label: string; value: string; plain?: boolean }) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd className={plain ? styles.plain : 'mono'}>{value}</dd>
    </div>
  );
}

/** "Crește cu 12%" with an arrow, green or red; the words say it too, not only the color. */
function ChangeLine({ change: c }: { change: Change }) {
  const { t } = useI18n();
  if (c.kind === 'up' || c.kind === 'down') {
    const Icon = c.kind === 'up' ? ArrowUpRight : ArrowDownRight;
    return (
      <span className={`${styles.change} ${c.kind === 'up' ? styles.green : styles.red}`}>
        <Icon size={14} aria-hidden="true" />
        {t(`rep.change.${c.kind}`, { n: c.percent })}
      </span>
    );
  }
  return (
    <span className={`${styles.change} ${styles.muted}`}>
      <ArrowRight size={14} aria-hidden="true" />
      {t(`rep.change.${c.kind}`)}
    </span>
  );
}

/** A figure in lei without the currency (the label says it): `12.450`, `340,50`. */
function formatAmount(lang: Lang, amount: number): string {
  return formatMoney(lang, amount).replace(/\s*(lei|RON)$/, '');
}

function formatDuration(lang: Lang, ms: number): string {
  const d = duration(ms);
  return plural(lang, `unit.${d.unit}`, d.value);
}

/** The period's takings for the accountant: finished jobs and inspection fees, one row each. */
function downloadCsv(jobs: readonly ReportJob[], range: DayRange, period: ReportPeriod, lang: Lang, t: I18nValue['t'], today: string) {
  const { separator, decimal } = csvFormat(lang);
  const header = [
    t('hist.col.date'),
    t('hist.col.ref'),
    t('rep.col.kind'),
    t('hist.col.plate'),
    t('hist.col.car'),
    t('hist.col.client'),
    t('hist.col.service'),
    t('hist.col.amount'),
  ];
  const rows = csvJobs(jobs, range).map((j) => [
    jobDay(j),
    j.ref,
    t(j.status === 'done' ? 'rep.csv.kind.done' : 'rep.csv.kind.fee'),
    j.car_snapshot.plate ?? '',
    [j.car_snapshot.make, j.car_snapshot.model, j.car_snapshot.year].filter(Boolean).join(' '),
    j.client_name ?? '',
    (lang === 'ro' ? j.service_ro : j.service_en) ?? j.service_id,
    csvAmount(j.cost, decimal),
  ]);
  const blob = new Blob([toCsv([header, ...rows], separator)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${t('rep.csv.file')}-${t(`rep.period.${period}`).toLowerCase().replace(/\s+/g, '-')}-${today}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
