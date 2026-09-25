import { FileCheck, SearchX } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip, ChipRow } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { SkeletonList } from '../../components/Skeleton';
import { fetchHistoryReports, voidHistoryReport, type AdminReportRow } from '../../data/adminTools';
import { downloadReport, ReportError } from '../../data/reports';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { plural } from '../../i18n/translate';
import { filterReports, isReportFilter, REPORT_FILTERS } from '../../lib/adminTools';
import { reportFileName, saveFile } from '../../lib/report';
import { ConfirmPanel } from './ActionPanels';
import { Facts, Money, Pill } from './parts';
import { ADMIN_ACCOUNT_PATH, adminClientPath } from './paths';
import { useLiveData } from './useLiveData';
import { useUrlParams } from './useUrlParams';
import { carText, dateTime } from './format';
import styles from './admin.module.css';

const LIVE = [{ table: 'history_reports' }];

const TONE = { generated: 'green', paid: 'amber', void: 'red', pending_payment: 'grey' } as const;

function ReportCard({ r, onVoided }: { r: AdminReportRow; onVoided: () => void }) {
  const { t, lang } = useI18n();
  const [voiding, setVoiding] = useState(false);
  const canVoid = r.status === 'paid' || r.status === 'generated';
  const canDownload = r.status === 'generated' || (r.status === 'void' && r.generated_at !== null);
  return (
    <Card className={styles.stack}>
      <div className={styles.cardHead}>
        <span className={`${styles.rowTitle} mono`}>{r.code}</span>
        <Pill tone={TONE[r.status]}>{t(`admin.reports.status.${r.status}` as MessageKey)}</Pill>
      </div>
      <Facts
        rows={[
          [t('admin.reports.car'), [carText(r.car_snapshot), r.car_snapshot.plate].filter(Boolean).join(' · ')],
          [
            t('admin.reports.client'),
            r.client_id ? (
              <Link key="client" className={styles.link} to={adminClientPath(r.client_id)}>
                {[r.client_display_id, r.client_name].filter(Boolean).join(' · ')}
              </Link>
            ) : (
              t('admin.deletedAccount')
            ),
          ],
          [t('admin.reports.jobs'), String(r.job_count)],
          [t('admin.reports.paid'), r.paid_at ? <Money key="paid" amount={r.amount_paid} /> : null],
          [t('admin.reports.paidAt'), r.paid_at ? dateTime(lang, r.paid_at) : null],
          [t('admin.reports.generatedAt'), r.generated_at ? dateTime(lang, r.generated_at) : null],
          [t('admin.reports.lang'), t(r.lang === 'en' ? 'admin.lang.en' : 'admin.lang.ro')],
          ...(r.status === 'void'
            ? ([
                [t('admin.reports.voidedAt'), dateTime(lang, r.voided_at)],
                [t('admin.reports.voidReason'), r.void_reason],
              ] as [string, string | null][])
            : []),
        ]}
      />
      {!voiding && (canDownload || canVoid) && (
        <div className={styles.panelButtons}>
          {canDownload && (
            <ActionButton
              variant="secondary"
              onAction={async () => saveFile(await downloadReport(r.id), reportFileName(r.lang, r.code))}
              errorMessage={(e) => (e instanceof ReportError ? t(`report.error.${e.problem}` as MessageKey) : rpcErrorMessage(lang, e))}
              canRetry={canRetryRpc}
            >
              {t('reports.download')}
            </ActionButton>
          )}
          {canVoid && (
            <Button variant="danger" onClick={() => setVoiding(true)}>
              {t('admin.reports.void')}
            </Button>
          )}
        </div>
      )}
      {voiding && (
        <ConfirmPanel
          title={t('admin.reports.voidTitle', { code: r.code })}
          body={t('admin.reports.voidBody')}
          textLabel={t('admin.reason')}
          textHint={t('admin.reports.voidHint')}
          textRequired
          confirmLabel={t('admin.reports.void')}
          danger
          onConfirm={async (reason, requestId) => {
            await voidHistoryReport(r.id, reason, requestId);
            setVoiding(false);
            onVoided();
          }}
          onCancel={() => setVoiding(false)}
        />
      )}
    </Card>
  );
}

/**
 * Rapoarte de istoric (FR §5.6b): every report sold — code, client, car, date, amount — with the
 * PDF, and "Anulează raportul" for one issued in error (a reason is required; /verifica then says
 * "Raport anulat" and the client can no longer download it). Checkouts never paid are under their
 * own chip. Live.
 */
export function ReportsScreen() {
  const { t, lang } = useI18n();
  const { state, reload, refetch } = useLiveData(fetchHistoryReports, LIVE, 'admin-reports');
  const { params, setParam, text, setText } = useUrlParams();
  const filterParam = params.get('stare');
  const filter = isReportFilter(filterParam) ? filterParam : 'all';
  const query = useDeferredValue(text);
  const all = state.status === 'ready' ? state.data : null;
  const shown = useMemo(() => (all ? filterReports(all, query, filter) : []), [all, query, filter]);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className={styles.page}>
      <BackLink to={ADMIN_ACCOUNT_PATH} label={t('nav.account')} />
      <div>
        <h1>{t('admin.reports.title')}</h1>
        <p className={styles.sub}>{all ? plural(lang, 'unit.reports', shown.length) : t('admin.reports.sub')}</p>
      </div>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {all && all.length === 0 && <EmptyState icon={FileCheck} title={t('admin.reports.empty')} />}
      {all && all.length > 0 && (
        <>
          <div className={styles.controls}>
            <SearchField
              id="admin-reports-q"
              label={t('admin.reports.search')}
              placeholder={t('admin.reports.search')}
              value={text}
              onChange={setText}
              onClear={() => {
                setText('');
                setParam({ q: null });
              }}
              clearLabel={t('admin.search.clear')}
            />
            <ChipRow label={t('admin.filter.state')}>
              {REPORT_FILTERS.map((f) => (
                <Chip key={f} selected={filter === f} onClick={() => setParam({ stare: f === 'all' ? null : f })}>
                  {t(`admin.reports.filter.${f}` as MessageKey)}
                </Chip>
              ))}
            </ChipRow>
          </div>
          {notice && (
            <p className={styles.muted} role="status">
              {notice}
            </p>
          )}
          {shown.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={t('admin.noResults')}
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    setText('');
                    setParam({ q: null, stare: null });
                  }}
                >
                  {t('admin.clearFilters')}
                </Button>
              }
            />
          ) : (
            <ul className={styles.list}>
              {shown.map((r) => (
                <li key={r.id}>
                  <ReportCard
                    r={r}
                    onVoided={() => {
                      setNotice(t('admin.reports.voided', { code: r.code }));
                      void refetch().catch(() => {});
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
