import { Fragment, useCallback, useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { InlinePanel } from '../../components/InlinePanel';
import { LoadError } from '../../components/LoadError';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { Spinner } from '../../components/Spinner';
import { TextArea } from '../../components/TextArea';
import { adminZoneBack } from '../../app/adminZones';
import {
  AUDIT_CLASSES,
  auditPrivacyReport,
  BATCH_SIZES,
  DEFAULT_BATCH,
  findingList,
  isLogJob,
  listRetentionJobs,
  REPORT_KINDS,
  type AuditPrivacyReport,
  type LogCounts,
  type RetentionCounts,
  RETENTION_REASON_MAX,
  RETENTION_REASON_MIN,
  retentionPreview,
  setRetentionJob,
  type RetentionJobState,
  type RetentionPreview,
  type RetentionRun,
} from '../../data/retention';
import { canRetryRpc, rpcErrorMessage, toRpcError } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { formatDecimal, formatTime } from '../../i18n/format';
import type { MessageKey } from '../../i18n/ro';
import { ro } from '../../i18n/ro';
import { useLoad } from '../../lib/useLoad';
import { actionLabel, dateTime } from './format';
import { Pill, SectionTitle } from './parts';
import { ADMIN_RETENTION_PATH } from './paths';
import styles from './admin.module.css';
import supportStyles from '../support/support.module.css';

/** „‹ Platformă” (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_RETENTION_PATH);

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

const who = (s: { display_id?: string | null; name?: string | null } | null | undefined) =>
  [s?.display_id, s?.name].filter(Boolean).join(' · ') || '—';

/** A request's or a suggestion's state, in the words the team already reads. */
function statusLabel(t: T, status: string): string {
  if (`support.staffStatus.${status}` in ro) return t(`support.staffStatus.${status}` as MessageKey);
  if (`sugg.status.${status}` in ro) return t(`sugg.status.${status}` as MessageKey);
  return t('admin.retention.status.unknown');
}

/** What a run did, from its numbers. */
function runSummary(t: T, lang: 'ro' | 'en', run: RetentionRun): string {
  const parts = Object.entries(run.counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${`admin.field.${k}` in ro ? t(`admin.field.${k}` as MessageKey) : k}: ${formatDecimal(lang, n)}`);
  if (run.failed > 0) parts.push(`${t('admin.field.failed')}: ${formatDecimal(lang, run.failed)}`);
  if (run.remaining > 0) parts.push(`${t('admin.field.remaining')}: ${formatDecimal(lang, run.remaining)}`);
  return parts.join(' · ') || '0';
}

/**
 * The preview of a job: exactly what the next run would process, the exceptions apart. It is read with
 * a database function that cannot write, so opening it changes nothing.
 */
function RequestPreviewFacts({ preview }: { preview: RetentionPreview }) {
  const { t, lang } = useI18n();
  const c = preview.counts as RetentionCounts;
  const n = (v: number | undefined) => formatDecimal(lang, v ?? 0);
  const statuses = Object.entries(c.eligible.by_status);
  const found = findingList(c.findings ?? {});
  return (
    <div className={supportStyles.form}>
      <p className={styles.muted}>{t('admin.retention.previewAt', { time: formatTime(lang, new Date(preview.now)) })}</p>
      <h3 className={styles.rowTitle}>{t('admin.retention.eligible')}</h3>
      <dl className={styles.facts}>
        <dt>{t(`admin.retention.eligible.${preview.job}`)}</dt>
        <dd>{n(c.eligible.total)}</dd>
        {statuses.length > 0 && (
          <>
            <dt>{t('admin.retention.eligible.byStatus')}</dt>
            <dd>{statuses.map(([s, k]) => `${statusLabel(t, s)}: ${n(k)}`).join(' · ')}</dd>
          </>
        )}
        <dt>{t('admin.retention.eligible.messages')}</dt>
        <dd>{n(c.eligible.messages)}</dd>
        <dt>{t('admin.retention.eligible.notes')}</dt>
        <dd>{n(c.eligible.notes)}</dd>
        <dt>{t('admin.retention.eligible.files')}</dt>
        <dd>{n(c.eligible.files)}</dd>
        <dt>{t('admin.retention.eligible.notifications')}</dt>
        <dd>{n(c.eligible.notifications)}</dd>
        {preview.job === 'suggestions' && (
          <>
            <dt>{t('admin.retention.findings')}</dt>
            <dd>
              {found.length === 0
                ? t('admin.retention.findingsNone')
                : found.map((f) => `${t(`support.textReview.kind.${f.kind}`)}: ${n(f.n)}`).join(' · ')}
            </dd>
            <dt>{t('admin.retention.withoutProposal')}</dt>
            <dd>{n(c.without_proposal)}</dd>
          </>
        )}
        {c.reviews && (
          <>
            <dt>{t('admin.retention.reviews')}</dt>
            <dd>
              {t('admin.retention.reviews.detail', { pending: n(c.reviews.pending), expiring: n(c.reviews.expiring), soon: n(c.reviews.due_7_days) })}
            </dd>
          </>
        )}
      </dl>
      <h3 className={styles.rowTitle}>{t('admin.retention.exempt')}</h3>
      <dl className={styles.facts}>
        <dt>{t('admin.retention.exempt.legalHold')}</dt>
        <dd>
          {n(c.exempt.legal_hold)}
          {c.exempt.legal_hold > 0 && (
            <span className={styles.muted}>
              {' · '}
              {t('admin.retention.exempt.detail', {
                request: n(c.exempt.legal_hold_request),
                account: n(c.exempt.legal_hold_account),
                deleted: n(c.exempt.author_deleted),
              })}
            </span>
          )}
        </dd>
      </dl>
      <p className={styles.muted}>
        {c.next_due_at ? t('admin.retention.nextDue', { date: dateTime(lang, c.next_due_at) }) : t('admin.retention.nextNone')}
      </p>
    </div>
  );
}

/** The preview of a log job (A3c2b2): rows written after the cutoff only. */
function LogPreviewFacts({ preview }: { preview: RetentionPreview }) {
  const { t, lang } = useI18n();
  const c = preview.counts as LogCounts;
  const n = (v: number | undefined) => formatDecimal(lang, v ?? 0);
  const classes = AUDIT_CLASSES.filter((k) => (c.eligible.by_class[k] ?? 0) > 0);
  return (
    <div className={supportStyles.form}>
      <p className={styles.muted}>{t('admin.retention.previewAt', { time: formatTime(lang, new Date(preview.now)) })}</p>
      <h3 className={styles.rowTitle}>{t('admin.retention.eligible')}</h3>
      <dl className={styles.facts}>
        <dt>{t('admin.retention.log.rows')}</dt>
        <dd>
          {n(c.eligible.total)}
          {classes.length > 0 && (
            <span className={styles.muted}>
              {' · '}
              {classes.map((k) => `${t(`admin.retention.class.${k}`)}: ${n(c.eligible.by_class[k])}`).join(' · ')}
            </span>
          )}
        </dd>
        {preview.job === 'support_log' && (
          <>
            <dt>{t('admin.retention.log.searchTerms')}</dt>
            <dd>{n(c.eligible.search_terms)}</dd>
          </>
        )}
      </dl>
      <h3 className={styles.rowTitle}>{t('admin.retention.exempt')}</h3>
      <dl className={styles.facts}>
        <dt>{t('admin.retention.exempt.legalHold')}</dt>
        <dd>{n(c.exempt.legal_hold)}</dd>
        <dt>{t('admin.retention.log.legalActive')}</dt>
        <dd>{n(c.exempt.legal_active)}</dd>
        <dt>{t('admin.retention.log.beforeCutoff')}</dt>
        <dd>{n(c.exempt.before_cutoff)}</dd>
      </dl>
      <p className={styles.muted}>
        {c.next_due_at ? t('admin.retention.nextDue', { date: dateTime(lang, c.next_due_at) }) : t('admin.retention.nextNone')}
      </p>
    </div>
  );
}

function PreviewFacts({ preview }: { preview: RetentionPreview }) {
  return isLogJob(preview.job) ? <LogPreviewFacts preview={preview} /> : <RequestPreviewFacts preview={preview} />;
}

/** Switching a job on: the numbers just previewed, the daily batch, a reason. */
function EnablePanel({
  preview,
  onDone,
  onChanged,
  onCancel,
}: {
  preview: RetentionPreview;
  onDone: () => Promise<void>;
  onChanged: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t, lang } = useI18n();
  const [batch, setBatch] = useState(String(DEFAULT_BATCH));
  const [reason, setReason] = useState('');
  const [short, setShort] = useState(false);
  return (
    <InlinePanel title={t('admin.retention.enable.title')} onClose={onCancel}>
      <p className={styles.warning}>{t('admin.retention.enable.body')}</p>
      <SelectField
        label={t('admin.retention.enable.batch')}
        value={batch}
        onChange={(e) => setBatch(e.target.value)}
        options={BATCH_SIZES.map((b) => ({ value: String(b), label: formatDecimal(lang, b) }))}
      />
      <TextArea
        label={t('admin.retention.enable.reason')}
        rows={3}
        maxLength={RETENTION_REASON_MAX}
        value={reason}
        error={short ? t('admin.retention.reasonShort') : null}
        onChange={(e) => {
          setReason(e.target.value);
          if (short) setShort(false);
        }}
      />
      <div className={styles.panelButtons}>
        <ActionButton
          variant="danger"
          onAction={async (requestId) => {
            if (reason.trim().length < RETENTION_REASON_MIN) {
              setShort(true);
              return;
            }
            try {
              await setRetentionJob(
                { job: preview.job, enabled: true, reason: reason.trim(), batchSize: Number(batch), expected: preview.counts },
                requestId,
              );
            } catch (e) {
              if (toRpcError(e).code === 'preview_changed') {
                await onChanged();
                return;
              }
              if (toRpcError(e).code === 'field_invalid' && toRpcError(e).params.field === 'reason') {
                setShort(true);
                return;
              }
              throw e;
            }
            await onDone();
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('admin.retention.enable.confirm')}
        </ActionButton>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </InlinePanel>
  );
}

/** Switching a job off: a reason, and at once. */
function DisablePanel({ job, onDone, onCancel }: { job: RetentionJobState; onDone: () => Promise<void>; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const [reason, setReason] = useState('');
  const [short, setShort] = useState(false);
  return (
    <InlinePanel title={t('admin.retention.disable.title')} onClose={onCancel}>
      <p className={styles.muted}>{t('admin.retention.disable.body')}</p>
      <TextArea
        label={t('admin.retention.disable.reason')}
        rows={3}
        maxLength={RETENTION_REASON_MAX}
        value={reason}
        error={short ? t('admin.retention.reasonShort') : null}
        onChange={(e) => {
          setReason(e.target.value);
          if (short) setShort(false);
        }}
      />
      <div className={styles.panelButtons}>
        <ActionButton
          onAction={async (requestId) => {
            if (reason.trim().length < RETENTION_REASON_MIN) {
              setShort(true);
              return;
            }
            await setRetentionJob({ job: job.key, enabled: false, reason: reason.trim(), batchSize: null, expected: null }, requestId);
            await onDone();
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('admin.retention.disable')}
        </ActionButton>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </InlinePanel>
  );
}

type PreviewState = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: RetentionPreview };

function JobCard({ job, cutoff, onChanged }: { job: RetentionJobState; cutoff: string; onChanged: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [panel, setPanel] = useState<'enable' | 'disable' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const last = job.runs[0];

  const loadPreview = useCallback(async () => {
    setPreview({ status: 'loading' });
    try {
      setPreview({ status: 'ready', data: await retentionPreview(job.key) });
    } catch {
      setPreview({ status: 'error' });
    }
  }, [job.key]);

  return (
    <Card>
      <div className={styles.stack}>
        <div className={styles.cardHead}>
          <h2 id={`job-${job.key}`} className={styles.cardTitle}>
            {t(`admin.retention.job.${job.key}`)}
          </h2>
          <Pill tone={job.enabled ? 'amber' : 'grey'}>
            {t(job.locked_reason ? 'admin.retention.locked' : job.enabled ? 'admin.retention.on' : 'admin.retention.off')}
          </Pill>
        </div>
        <p className={styles.muted}>{t(`admin.retention.rule.${job.key}`, { cutoff: dateTime(lang, cutoff) })}</p>
        {job.locked_reason && <p className={styles.warning}>{t('admin.retention.lockedBody')}</p>}
        <p>
          {job.changed_at
            ? t(job.enabled ? 'admin.retention.enabledBy' : 'admin.retention.disabledBy', {
                who: who(job.changed_by),
                date: dateTime(lang, job.changed_at),
                reason: job.reason ?? '—',
              })
            : t('admin.retention.neverEnabled')}
        </p>
        {job.enabled && <p>{t('admin.retention.batch', { count: formatDecimal(lang, job.batch_size) })}</p>}
        <p className={styles.muted}>
          {last ? `${t('admin.retention.lastRun', { date: dateTime(lang, last.finished_at) })} · ${runSummary(t, lang, last)}` : t('admin.retention.noRun')}
        </p>
        {notice && (
          <p className={supportStyles.notice} role="status">
            {notice}
          </p>
        )}

        <div className={styles.panelButtons}>
          <Button
            variant="secondary"
            onClick={() => {
              setNotice(null);
              void loadPreview();
            }}
          >
            {t('admin.retention.preview')}
          </Button>
          {job.enabled && panel === null && (
            <Button variant="secondary" onClick={() => setPanel('disable')}>
              {t('admin.retention.disable')}
            </Button>
          )}
        </div>

        {preview.status !== 'idle' && (
          <section aria-label={t('admin.retention.previewTitle')} aria-busy={preview.status === 'loading' || undefined}>
            <SectionTitle>{t('admin.retention.previewTitle')}</SectionTitle>
            {preview.status === 'loading' && <Spinner />}
            {preview.status === 'error' && <LoadError message={t('admin.retention.previewLoadError')} onRetry={() => void loadPreview()} />}
            {preview.status === 'ready' && (
              <>
                <PreviewFacts preview={preview.data} />
                {!job.enabled && !job.locked_reason && panel === null && (
                  <div className={styles.panelButtons}>
                    <Button onClick={() => setPanel('enable')}>{t('admin.retention.enable')}</Button>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {panel === 'enable' && preview.status === 'ready' && (
          <EnablePanel
            preview={preview.data}
            onCancel={() => setPanel(null)}
            onChanged={async () => {
              setPanel(null);
              setNotice(t('admin.retention.changed'));
              await loadPreview();
            }}
            onDone={async () => {
              setPanel(null);
              setPreview({ status: 'idle' });
              setNotice(t('admin.retention.enabled'));
              await onChanged();
            }}
          />
        )}
        {panel === 'disable' && (
          <DisablePanel
            job={job}
            onCancel={() => setPanel(null)}
            onDone={async () => {
              setPanel(null);
              setNotice(t('admin.retention.disabled'));
              await onChanged();
            }}
          />
        )}
      </div>
    </Card>
  );
}

/**
 * What the audit log holds that may be personal data or a secret (A3c2b2), counted per action, for
 * every row (the older ones included). Numbers only: no value ever leaves the database.
 */
function PrivacyReport() {
  const { t, lang } = useI18n();
  const [state, setState] = useState<{ status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: AuditPrivacyReport }>({
    status: 'idle',
  });
  const n = (v: number | undefined) => formatDecimal(lang, v ?? 0);
  const load = async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', data: await auditPrivacyReport() });
    } catch {
      setState({ status: 'error' });
    }
  };
  return (
    <Card>
      <div className={styles.stack}>
        <h2 className={styles.cardTitle}>{t('admin.retention.report.title')}</h2>
        <p className={styles.muted}>{t('admin.retention.report.desc')}</p>
        <div className={styles.panelButtons}>
          <Button variant="secondary" onClick={() => void load()}>
            {t('admin.retention.report.run')}
          </Button>
        </div>
        {state.status === 'loading' && <Spinner />}
        {state.status === 'error' && <LoadError message={t('admin.retention.reportLoadError')} onRetry={() => void load()} />}
        {state.status === 'ready' && (
          <>
            <p className={styles.muted}>
              {t('admin.retention.report.summary', {
                rows: n(state.data.rows),
                legacy: n(state.data.legacy_rows),
                cutoff: dateTime(lang, state.data.cutoff),
              })}
            </p>
            <dl className={styles.facts}>
              {REPORT_KINDS.map((k) => (
                <Fragment key={k}>
                  <dt>{t(`admin.retention.report.kind.${k}`)}</dt>
                  <dd>{n(state.data.totals[k])}</dd>
                </Fragment>
              ))}
            </dl>
            {state.data.by_action.length > 0 && (
              <ul className={styles.list} aria-label={t('admin.retention.report.byAction')}>
                {state.data.by_action.map((a) => (
                  <li key={a.action}>
                    <span className={styles.rowTop}>
                      <span className={styles.rowTitle}>{actionLabel(t, a.action)}</span>
                      <Pill tone="grey">{t(`admin.retention.class.${a.class}`)}</Pill>
                    </span>
                    <span className={styles.rowMeta}>
                      <span>{t('admin.retention.report.rows', { rows: n(a.rows), legacy: n(a.legacy_rows) })}</span>
                      {REPORT_KINDS.filter((k) => a[k] > 0).map((k) => (
                        <span key={k}>{`${t(`admin.retention.report.kind.${k}`)}: ${n(a[k])}`}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Platformă → Retenția datelor (A3c2b1): the two jobs, off until an admin switches one on with the
 * numbers of its preview; what each run did. Admin only (the database refuses everyone else).
 */
export function RetentionScreen() {
  const { t } = useI18n();
  const { state, reload, setData } = useLoad(listRetentionJobs);
  const refresh = useCallback(async () => {
    const fresh = await listRetentionJobs().catch(() => null);
    if (fresh) setData(() => fresh);
  }, [setData]);

  return (
    <div className={styles.page}>
      <BackLink to={ZONE_BACK.to} label={t(ZONE_BACK.label)} />
      <div>
        <h1>{t('admin.retention.title')}</h1>
        <p className={styles.muted}>{t('admin.retention.desc')}</p>
      </div>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.retention.loadError')} onRetry={reload} />}
      {state.status === 'ready' && (
        <ul className={styles.list}>
          {state.data.items.map((j) => (
            <li key={j.key}>
              <JobCard job={j} cutoff={state.data.cutoff} onChanged={refresh} />
            </li>
          ))}
        </ul>
      )}
      {state.status === 'ready' && <PrivacyReport />}
    </div>
  );
}
