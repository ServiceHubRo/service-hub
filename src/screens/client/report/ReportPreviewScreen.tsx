import { EyeOff, FileCheck } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { BackLink } from '../../../components/BackLink';
import { Banner } from '../../../components/Banner';
import { Card } from '../../../components/Card';
import { Chip, ChipRow } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { getReportPreview, ReportError, startReportCheckout, type ReportJob, type ReportTarget } from '../../../data/reports';
import { rpcErrorMessage } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { formatDayMonth, formatKm, formatMoney } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import type { Lang } from '../../../i18n/translate';
import { formatPeriod, hiddenFrom } from '../../../lib/report';
import { useLoad } from '../../../lib/useLoad';
import {
  bookingCarHistoryPath,
  carHistoryPath,
  GARAGE_PATH,
  MY_REPORTS_PATH,
  type ReportLinkState,
} from '../paths';
import styles from './report.module.css';

/**
 * The official report of one car, before paying (FR §3.6b, P16e): the car, how many jobs, the
 * period and the total, the jobs with the last two lines hidden until paid, and "Plătește". Two
 * addresses: a garage car (/c/garaj/:carId/raport) and the car of a booking
 * (/c/programari/:bookingId/raport — also a car no longer in the garage). Stripe's page comes
 * back here with ?plata=anulata, or to Rapoartele mele after paying.
 */
export function ReportPreviewScreen() {
  const { t, lang } = useI18n();
  const { carId, bookingId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const from = (location.state as ReportLinkState | null)?.from ?? 'history';
  const [reportLang, setReportLang] = useState<Lang>(lang);

  const target: ReportTarget | null = carId ? { carId } : bookingId ? { bookingId } : null;
  const load = useCallback(() => getReportPreview(carId ? { carId } : { bookingId: bookingId ?? '' }), [carId, bookingId]);
  const { state, reload } = useLoad(load);

  const back =
    from === 'reports' ? (
      <BackLink to={MY_REPORTS_PATH} label={t('reports.title')} />
    ) : from === 'garage' ? (
      <BackLink to={GARAGE_PATH} label={t('nav.client.garage')} />
    ) : (
      <BackLink to={carId ? carHistoryPath(carId) : bookingCarHistoryPath(bookingId ?? '')} label={t('vh.see')} />
    );

  if (state.status === 'loading') {
    return (
      <div className={styles.page}>
        {back}
        <SkeletonList />
      </div>
    );
  }
  if (state.status === 'error' || !target) {
    return (
      <div className={styles.page}>
        {back}
        <LoadError message={state.status === 'error' ? rpcErrorMessage(lang, state.error) : t('report.loadError')} onRetry={reload} />
      </div>
    );
  }

  const { car, jobs, facts, price } = state.data;
  const name = [car.make, car.model].filter(Boolean).join(' ') || t('sb.card.noCar');
  const firstHidden = hiddenFrom(jobs.length);

  return (
    <div className={styles.page}>
      {back}
      <div>
        <h1>{t('report.title')}</h1>
        <p className={styles.sub}>
          {name}
          {car.plate && (
            <>
              {' · '}
              <span className="mono">{car.plate}</span>
            </>
          )}
        </p>
      </div>
      {params.get('plata') === 'anulata' && <Banner tone="warning">{t('report.cancelled')}</Banner>}

      {jobs.length === 0 ? (
        <EmptyState icon={FileCheck} title={t('report.noJobs')} body={t('report.noJobsBody')} />
      ) : (
        <>
          <p className={styles.note}>{t('report.intro')}</p>

          <h2 className={styles.section}>{t('report.contains')}</h2>
          <Card className={styles.card}>
            <dl className={styles.facts}>
              <Fact label={t('report.car')} value={[name, car.year].filter(Boolean).join(' · ')} />
              <Fact label={t('report.plate')} value={car.plate ?? '—'} mono />
              {car.vin && <Fact label={t('report.vin')} value={car.vin} mono />}
              <Fact label={t('report.period')} value={formatPeriod(lang, facts.period_from, facts.period_to)} />
              <Fact label={t('report.jobs')} value={String(facts.job_count)} big />
              <Fact label={t('report.total')} value={formatMoney(lang, facts.total)} big />
              {facts.latest_odometer !== null && <Fact label={t('report.lastKm')} value={formatKm(lang, facts.latest_odometer)} big />}
            </dl>
            {facts.odometer_out_of_order && <p className={styles.note}>{t('report.kmNote')}</p>}
          </Card>

          <h2 className={styles.section}>{t('report.list')}</h2>
          <Card className={styles.card}>
            <ul className={styles.jobs}>
              {jobs.map((job, i) => (
                <JobRow key={job.id} job={job} hidden={i >= firstHidden} />
              ))}
            </ul>
            {firstHidden < jobs.length && (
              <p className={styles.hiddenNote}>
                <EyeOff size={15} aria-hidden="true" />
                {t('report.hidden')}
              </p>
            )}
          </Card>
          <p className={`${styles.note} ${styles.strong}`}>{t('report.onlyServiceHub')}</p>

          <Card className={styles.pay}>
            <div className={styles.langRow}>
              <span className={styles.label}>
                {t('report.lang')}
              </span>
              <ChipRow label={t('report.lang')}>
                {(['ro', 'en'] as const).map((l) => (
                  <Chip key={l} selected={reportLang === l} onClick={() => setReportLang(l)}>
                    {t(`lang.${l}` as MessageKey)}
                  </Chip>
                ))}
              </ChipRow>
            </div>
            <ActionButton
              onAction={async (requestId) => {
                const answer = await startReportCheckout(target, { lang: reportLang, returnPath: location.pathname, requestId });
                if ('url' in answer) window.location.assign(answer.url);
                else navigate(`${MY_REPORTS_PATH}?raport=${answer.reportId}`);
              }}
              errorMessage={(e) => (e instanceof ReportError ? t(`report.error.${e.problem}` as MessageKey) : rpcErrorMessage(lang, e))}
            >
              {t('report.pay', { price: formatMoney(lang, price) })}
            </ActionButton>
            <p className={styles.muted}>{t('report.stripeNote')}</p>
            <p className={styles.muted}>{t('report.after')}</p>
            <p className={styles.muted}>{t('report.snapshot')}</p>
          </Card>
        </>
      )}
    </div>
  );
}

function Fact({ label, value, mono, big }: { label: string; value: string; mono?: boolean; big?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={`${mono ? 'mono' : ''} ${big ? styles.big : ''}`}>{value}</dd>
    </div>
  );
}

/** One job of the preview; a hidden one is blurred and left out for screen readers. */
function JobRow({ job, hidden }: { job: ReportJob; hidden: boolean }) {
  const { lang } = useI18n();
  const service = (lang === 'en' ? job.service_en || job.service_ro : job.service_ro || job.service_en) || job.service_id || '';
  return (
    <li className={`${styles.job} ${hidden ? styles.blurred : ''}`} aria-hidden={hidden || undefined}>
      <span className={styles.jobWhat}>
        <span className={styles.jobService}>{service}</span>
        <br />
        <span className={styles.muted}>{[job.shop_name, job.shop_city].filter(Boolean).join(' · ')}</span>
      </span>
      <span className={styles.jobSide}>
        {job.cost !== null && <span className={`mono ${styles.amount}`}>{formatMoney(lang, job.cost)}</span>}
        <br />
        <span className={`mono ${styles.muted}`}>
          {formatDayMonth(lang, job.date)}
          {job.odometer !== null && ` · ${formatKm(lang, job.odometer)}`}
        </span>
      </span>
    </li>
  );
}
