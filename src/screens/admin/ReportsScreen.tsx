import { FileCheck, SearchX } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ChoiceFilters } from '../../components/Filters';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { DetailFacts, DetailPane, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { fetchHistoryReports, voidHistoryReport, type AdminReportRow } from '../../data/adminTools';
import { downloadReport, ReportError } from '../../data/reports';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { adminZoneBack } from '../../app/adminZones';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { plural } from '../../i18n/translate';
import { filterReports, isReportFilter, REPORT_FILTERS } from '../../lib/adminTools';
import { reportFileName, saveFile } from '../../lib/report';
import { useListDetail } from '../../lib/useListDetail';
import { ConfirmPanel } from './ActionPanels';
import { Money, Pill } from './parts';
import { ADMIN_REPORTS_PATH, adminClientPath } from './paths';
import { useLiveData } from './useLiveData';
import { useUrlParams } from './useUrlParams';
import { carText, dateTime } from './format';
import styles from './admin.module.css';
import { PageHeader } from '../../components/PageHeader';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_REPORTS_PATH);

const LIVE = [{ table: 'history_reports' }];

const TONE = { generated: 'green', paid: 'amber', void: 'red', pending_payment: 'grey' } as const;

function ReportDetail({ r, notice, onVoided }: { r: AdminReportRow; notice: string | null; onVoided: () => void }) {
  const { t, lang } = useI18n();
  const [voiding, setVoiding] = useState(false);
  const canVoid = r.status === 'paid' || r.status === 'generated';
  const canDownload = r.status === 'generated' || (r.status === 'void' && r.generated_at !== null);
  return (
    <DetailPane
      id={r.id}
      icon={<FileCheck size={20} />}
      title={r.code}
      detail={[carText(r.car_snapshot), r.car_snapshot.plate].filter(Boolean).join(' · ')}
      status={<Pill tone={TONE[r.status]}>{t(`admin.reports.status.${r.status}` as MessageKey)}</Pill>}
      message={notice ? { tone: 'success', text: notice } : undefined}
      panel={
        voiding ? (
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
        ) : undefined
      }
      actions={
        canDownload || canVoid ? (
          <>
            {canDownload && (
              <ActionButton
                variant="secondary"
                block={false}
                onAction={async () => saveFile(await downloadReport(r.id), reportFileName(r.lang, r.code))}
                errorMessage={(e) =>
                  e instanceof ReportError ? t(`report.error.${e.problem}` as MessageKey) : rpcErrorMessage(lang, e)
                }
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
          </>
        ) : undefined
      }
    >
      <DetailFacts
        items={[
          { label: t('admin.reports.car'), value: [carText(r.car_snapshot), r.car_snapshot.plate].filter(Boolean).join(' · ') || '—' },
          {
            label: t('admin.reports.client'),
            value: r.client_id ? (
              <Link className={styles.link} to={adminClientPath(r.client_id)}>
                {[r.client_display_id, r.client_name].filter(Boolean).join(' · ')}
              </Link>
            ) : (
              t('admin.deletedAccount')
            ),
          },
          { label: t('admin.reports.jobs'), value: String(r.job_count) },
          { label: t('admin.reports.paid'), value: r.paid_at ? <Money amount={r.amount_paid} /> : '—' },
          { label: t('admin.reports.paidAt'), value: r.paid_at ? dateTime(lang, r.paid_at) : '—' },
          { label: t('admin.reports.generatedAt'), value: r.generated_at ? dateTime(lang, r.generated_at) : '—' },
          { label: t('admin.reports.lang'), value: t(r.lang === 'en' ? 'admin.lang.en' : 'admin.lang.ro') },
          ...(r.status === 'void'
            ? [
                { label: t('admin.reports.voidedAt'), value: dateTime(lang, r.voided_at) },
                { label: t('admin.reports.voidReason'), value: r.void_reason || '—' },
              ]
            : []),
        ]}
      />
    </DetailPane>
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
  const { pathname } = useLocation();
  const { state, reload, refetch } = useLiveData(fetchHistoryReports, LIVE, 'admin-reports');
  const { params, setParam, text, setText } = useUrlParams();
  const filterParam = params.get('stare');
  const filter = isReportFilter(filterParam) ? filterParam : 'all';
  const query = useDeferredValue(text);
  const all = state.status === 'ready' ? state.data : null;
  const shown = useMemo(() => (all ? filterReports(all, query, filter) : []), [all, query, filter]);
  // What was done to a report is told in its detail.
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);

  // Page template A (docs/MODEL_DE_FOLOSIRE.md P8): one row per report, the chosen one beside the list
  // from 1024 px (in its place below).
  const { wide, selectedId, open, select } = useListDetail(
    shown.map((r) => r.id),
    'raport',
  );
  const chosen = shown.find((r) => r.id === selectedId) ?? null;

  const header = (
    <>
      <PageHeader back={{ to: ZONE_BACK.to, label: t(ZONE_BACK.label) }} title={t('admin.reports.title')} subtitle={all ? plural(lang, 'unit.reports', shown.length) : t('admin.reports.sub')} />
      {all && all.length > 0 && (
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
          <ChoiceFilters
            groups={[
              {
                key: 'stare',
                title: t('admin.filter.state'),
                options: REPORT_FILTERS.map((f) => ({ value: f, label: t(`admin.reports.filter.${f}` as MessageKey) })),
                value: filter,
                defaultValue: 'all',
                onChange: (v) => setParam({ stare: v === 'all' ? null : v }),
              },
            ]}
          />
        </div>
      )}
    </>
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('admin.loadError')} onRetry={reload} />;
  else if (all && all.length === 0) list = <EmptyState icon={FileCheck} title={t('admin.reports.empty')} />;
  else if (shown.length === 0)
    list = (
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
    );
  else
    list = (
      <ListRows label={t('admin.reports.title')}>
        {shown.map((r) => (
          <ListRow
            key={r.id}
            icon={<FileCheck size={20} />}
            title={r.code}
            detail={[carText(r.car_snapshot), r.car_snapshot.plate, r.paid_at ? dateTime(lang, r.paid_at) : null].filter(Boolean).join(' · ')}
            status={<Pill tone={TONE[r.status]}>{t(`admin.reports.status.${r.status}` as MessageKey)}</Pill>}
            selected={wide && r.id === selectedId}
            onSelect={() => select(r.id)}
          />
        ))}
      </ListRows>
    );

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={pathname}
        backLabel={t('admin.reports.title')}
        header={header}
        list={list}
        detail={
          chosen && (
            <ReportDetail
              key={chosen.id}
              r={chosen}
              notice={notice?.id === chosen.id ? notice.text : null}
              onVoided={() => {
                setNotice({ id: chosen.id, text: t('admin.reports.voided', { code: chosen.code }) });
                void refetch().catch(() => {});
              }}
            />
          )
        }
      />
    </div>
  );
}
