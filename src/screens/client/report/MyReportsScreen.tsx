import { Car as CarIcon, ChevronRight, Download, FileCheck, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { NAV } from '../../../app/roles';
import { useSession } from '../../../app/sessionContext';
import { ActionButton } from '../../../components/ActionButton';
import { BackLink } from '../../../components/BackLink';
import { Banner } from '../../../components/Banner';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { fetchCars } from '../../../data/garage';
import {
  downloadReport,
  fetchMyReports,
  ReportError,
  retryReport,
  subscribeMyReports,
  type MyReport,
} from '../../../data/reports';
import { rpcErrorMessage } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { formatDayMonth } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import { plural } from '../../../i18n/translate';
import { reportCandidates, reportFileName, saveFile } from '../../../lib/report';
import { useLoad } from '../../../lib/useLoad';
import { useNow } from '../../../lib/useNow';
import { useClientBookings } from '../bookings/clientBookingsContext';
import { bookingReportPath, carReportPath, type ReportLinkState } from '../paths';
import styles from './report.module.css';

const FROM_REPORTS: ReportLinkState = { from: 'reports' };
/** A paid report still without its PDF after this long gets "Pregătește raportul acum". */
const RETRY_AFTER_MS = 45_000;

/**
 * Cont → Rapoartele mele (FR §3.6b, §3.8): every report bought, newest first, with its code and
 * "Descarcă PDF" (free, any number of times), live through Realtime — a report just paid turns
 * from "Se pregătește" to "Gata" by itself. Below, the cars a new report can be bought for.
 * Stripe comes back here with ?plata=ok&raport=<id>.
 */
export function MyReportsScreen() {
  const { t } = useI18n();
  const session = useSession();
  const userId = session.user?.id ?? null;
  const [params] = useSearchParams();
  const returned = params.get('plata') === 'ok' || params.has('raport');
  const highlight = params.get('raport');

  const { state, reload, setData } = useLoad(fetchMyReports);
  useEffect(() => {
    if (!userId) return;
    return subscribeMyReports(userId, () => {
      fetchMyReports().then(setData, () => {});
    });
  }, [userId, setData]);

  const reports = state.status === 'ready' ? state.data : null;
  const justPaid = highlight && reports ? reports.find((r) => r.id === highlight) : undefined;

  return (
    <div className={styles.page}>
      <BackLink to={NAV.client.account.path} label={t('nav.account')} />
      <div>
        <h1>{t('reports.title')}</h1>
        <p className={styles.sub}>{t('reports.intro')}</p>
      </div>

      {returned && (
        <Banner tone="info">{justPaid?.status === 'generated' ? t('reports.return.done') : t('reports.return.ok')}</Banner>
      )}

      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('reports.loadError')} onRetry={reload} />}
      {reports &&
        (reports.length === 0 ? (
          <EmptyState icon={FileCheck} title={t('reports.empty')} body={t('reports.emptyBody')} />
        ) : (
          <>
            <ul className={styles.list}>
              {reports.map((r) => (
                <li key={r.id}>
                  <ReportCard report={r} highlighted={r.id === highlight} />
                </li>
              ))}
            </ul>
            <p className={styles.muted}>{t('reports.verifyHint', { address: `${window.location.host}/verifica` })}</p>
          </>
        ))}

      <NewReport />
    </div>
  );
}

function ReportCard({ report: r, highlighted }: { report: MyReport; highlighted: boolean }) {
  const { t, lang } = useI18n();
  const now = useNow(15_000);
  const [retried, setRetried] = useState(false);
  const car = [r.car_snapshot.make, r.car_snapshot.model].filter(Boolean).join(' ') || t('sb.card.noCar');
  const pill =
    r.status === 'generated' ? styles.pillGreen : r.status === 'void' ? styles.pillMuted : styles.pillAmber;
  const since = r.paid_at ? now.getTime() - new Date(r.paid_at).getTime() : 0;
  const errorMessage = (e: unknown) => (e instanceof ReportError ? t(`report.error.${e.problem}` as MessageKey) : rpcErrorMessage(lang, e));

  return (
    <Card className={`${styles.card} ${highlighted ? styles.highlight : ''}`}>
      <div className={styles.head}>
        <div>
          <p className={styles.carName}>{car}</p>
          {r.car_snapshot.plate && <p className={`mono ${styles.plate}`}>{r.car_snapshot.plate}</p>}
        </div>
        <span className={`${styles.pill} ${pill}`}>
          {r.status === 'paid' && <LoaderCircle size={12} className={styles.spin} aria-hidden="true" />}
          {t(`reports.state.${r.status === 'pending_payment' ? 'paid' : r.status}` as MessageKey)}
        </span>
      </div>
      <p className={`mono ${styles.code}`}>{r.code}</p>
      <p className={styles.muted}>
        {r.generated_at
          ? t('reports.generatedOn', { date: formatDayMonth(lang, new Date(r.generated_at)) })
          : r.paid_at
            ? t('reports.paidOn', { date: formatDayMonth(lang, new Date(r.paid_at)) })
            : null}
        {' · '}
        {plural(lang, 'unit.jobs', r.job_count)}
      </p>

      {r.status === 'generated' && (
        <ActionButton
          variant="secondary"
          onAction={async () => saveFile(await downloadReport(r.id), reportFileName(r.lang, r.code))}
          errorMessage={errorMessage}
        >
          <span className={styles.withIcon}>
            <Download size={18} aria-hidden="true" />
            {t('reports.download')}
          </span>
        </ActionButton>
      )}
      {r.status === 'paid' && (
        <>
          <p className={styles.muted}>{t('reports.preparing')}</p>
          {(since > RETRY_AFTER_MS || retried) && (
            <ActionButton
              variant="secondary"
              onAction={async () => {
                setRetried(true);
                await retryReport(r.id);
              }}
              errorMessage={errorMessage}
            >
              {t('reports.retry')}
            </ActionButton>
          )}
        </>
      )}
      {r.status === 'void' && <p className={styles.muted}>{t('reports.void')}</p>}
    </Card>
  );
}

/** The cars a new report can be bought for: only cars with finished jobs. */
function NewReport() {
  const { t, lang } = useI18n();
  const { state: bookingsState } = useClientBookings();
  const { state: carsState } = useLoad(fetchCars);
  const candidates = useMemo(
    () =>
      bookingsState.status === 'ready' && carsState.status === 'ready'
        ? reportCandidates(carsState.data, bookingsState.data.bookings)
        : null,
    [bookingsState, carsState],
  );
  if (!candidates) return null;

  return (
    <>
      <h2 className={styles.section}>{t('reports.new')}</h2>
      {candidates.length === 0 ? (
        <p className={styles.muted}>{t('reports.newNone')}</p>
      ) : (
        <>
          <p className={styles.muted}>{t('reports.newHint')}</p>
          <Card>
            {candidates.map((c) => {
              const v = c.kind === 'car' ? c.car : c.vehicle;
              const name = [v.make, v.model].filter(Boolean).join(' ') || t('sb.card.noCar');
              const to = c.kind === 'car' ? carReportPath(c.car.id) : bookingReportPath(c.bookingId);
              return (
                <Link key={to} to={to} state={FROM_REPORTS} className={styles.row}>
                  <CarIcon size={18} aria-hidden="true" />
                  <span className={styles.rowText}>
                    {name}
                    {v.plate && <span className={`mono ${styles.rowMuted}`}> · {v.plate}</span>}
                    <br />
                    <span className={styles.rowMuted}>{plural(lang, 'unit.jobs', c.jobs)}</span>
                  </span>
                  <ChevronRight size={18} aria-hidden="true" />
                </Link>
              );
            })}
          </Card>
        </>
      )}
    </>
  );
}
