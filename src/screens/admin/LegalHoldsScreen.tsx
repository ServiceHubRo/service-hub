import { FileLock } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { LoadError } from '../../components/LoadError';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { TextArea } from '../../components/TextArea';
import { ViewSelect } from '../../components/ViewSelect';
import { adminZoneBack } from '../../app/adminZones';
import {
  getLegalHold,
  HOLD_REFERENCE_MAX,
  HOLD_REFERENCE_MIN,
  HOLD_TEXT_MAX,
  HOLD_TEXT_MIN,
  LEGAL_HOLD_BASES,
  listAdmins,
  listLegalHolds,
  placeLegalHold,
  releaseLegalHold,
  reviewLegalHold,
  reviewOverdue,
  type LegalHold,
  type LegalHoldBasis,
  type LegalHoldDetail,
} from '../../data/legalHolds';
import { canRetryRpc, toRpcError } from '../../data/rpc';
import type { StaffRef } from '../../data/supportRequests';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import { NotFound } from '../public/NotFound';
import { RequestStatusPill } from '../requests/parts';
import { ConfirmPanel } from './ActionPanels';
import { dateTime, day } from './format';
import { Pill, RowLink, SectionTitle } from './parts';
import { basisLabel, holdError, type HoldField } from './legalHoldText';
import { ADMIN_HOLDS_PATH, adminHoldPath, adminRequestPath } from './paths';
import styles from './admin.module.css';
import supportStyles from '../support/support.module.css';

/** „‹ Suport” (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_HOLDS_PATH);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const who = (s: Partial<StaffRef> | null | undefined) => [s?.display_id, s?.name].filter(Boolean).join(' · ') || '—';

/** Review date: in words and in red once passed (never color alone). */
function ReviewLine({ hold }: { hold: Pick<LegalHold, 'review_due_at' | 'released_at'> }) {
  const { t, lang } = useI18n();
  if (hold.released_at) return <span>{t('admin.holds.releasedOn', { date: day(lang, hold.released_at) })}</span>;
  return reviewOverdue(hold) ? (
    <span className={styles.danger}>{t('admin.holds.reviewOverdue', { date: day(lang, hold.review_due_at) })}</span>
  ) : (
    <span>{t('admin.holds.reviewDue', { date: day(lang, hold.review_due_at) })}</span>
  );
}

/**
 * The form of a new hold: on one account (Păstrare legală screen) or on one request (its page). The
 * basis is chosen, never preselected; reason and reference are required, checked again by the
 * database (lengths, no secrets).
 */
export function HoldForm({
  request,
  onPlaced,
  onCancel,
}: {
  /** A request hold; without it the form asks for the account ID. */
  request?: string;
  onPlaced: (id: string) => void;
  onCancel?: () => void;
}) {
  const { t, lang } = useI18n();
  const admins = useLoad(listAdmins);
  const [account, setAccount] = useState('');
  const [basis, setBasis] = useState<LegalHoldBasis | ''>('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [responsible, setResponsible] = useState('');
  const [errors, setErrors] = useState<Partial<Record<HoldField, string>>>({});
  const clear = (f: HoldField) => setErrors((e) => ({ ...e, [f]: undefined }));

  return (
    <form className={supportStyles.form} noValidate onSubmit={(e) => e.preventDefault()}>
      {!request && (
        <Field
          label={t('admin.holds.field.account')}
          autoComplete="off"
          maxLength={40}
          value={account}
          error={errors.account ?? null}
          onChange={(e) => {
            setAccount(e.target.value);
            clear('account');
          }}
        />
      )}
      <SelectField
        label={t('admin.holds.field.basis')}
        value={basis}
        onChange={(e) => {
          setBasis(e.target.value as LegalHoldBasis | '');
          clear('basis');
        }}
        aria-invalid={errors.basis ? true : undefined}
        options={[{ value: '', label: t('admin.holds.field.basisPick') }, ...LEGAL_HOLD_BASES.map((b) => ({ value: b, label: basisLabel(t, b) }))]}
      />
      {errors.basis && (
        <p className={styles.danger} role="alert">
          {errors.basis}
        </p>
      )}
      <TextArea
        label={t('admin.holds.field.reason')}
        hint={t('admin.holds.field.reasonHint')}
        rows={4}
        maxLength={HOLD_TEXT_MAX}
        value={reason}
        error={errors.reason ?? null}
        onChange={(e) => {
          setReason(e.target.value);
          clear('reason');
        }}
      />
      <Field
        label={t('admin.holds.field.reference')}
        hint={t('admin.holds.field.referenceHint')}
        autoComplete="off"
        maxLength={HOLD_REFERENCE_MAX}
        value={reference}
        error={errors.reference ?? null}
        onChange={(e) => {
          setReference(e.target.value);
          clear('reference');
        }}
      />
      {admins.state.status === 'ready' && admins.state.data.length > 1 && (
        <SelectField
          label={t('admin.holds.field.responsible')}
          value={responsible}
          onChange={(e) => setResponsible(e.target.value)}
          options={[{ value: '', label: t('admin.holds.field.responsibleMe') }, ...admins.state.data.map((a) => ({ value: a.id, label: who(a) }))]}
        />
      )}
      <div className={styles.panelButtons}>
        <ActionButton
          submit
          onAction={async (requestId) => {
            const gaps: Partial<Record<HoldField, string>> = {};
            if (!request && !account.trim()) gaps.account = t('admin.holds.err.accountRequired');
            if (!basis) gaps.basis = t('admin.holds.err.basisRequired');
            if (reason.trim().length < HOLD_TEXT_MIN) gaps.reason = t('admin.holds.err.reasonShort');
            if (reference.trim().length < HOLD_REFERENCE_MIN) gaps.reference = t('admin.holds.err.referenceShort');
            if (Object.keys(gaps).length > 0 || !basis) {
              setErrors(gaps);
              return;
            }
            try {
              const res = await placeLegalHold(
                {
                  request,
                  account: request ? undefined : account.trim(),
                  basis,
                  reason: reason.trim(),
                  reference: reference.trim(),
                  responsible: responsible || null,
                },
                requestId,
              );
              setAccount('');
              setBasis('');
              setReason('');
              setReference('');
              setResponsible('');
              onPlaced(res.id);
            } catch (e) {
              const err = holdError(lang, e);
              if (err.field) {
                setErrors({ [err.field]: err.message });
                return;
              }
              throw e;
            }
          }}
          errorMessage={(e) => holdError(lang, e).message}
          canRetry={canRetryRpc}
        >
          {t('admin.holds.place')}
        </ActionButton>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}

function HoldRow({ hold }: { hold: LegalHold }) {
  const { t, lang } = useI18n();
  return (
    <RowLink to={adminHoldPath(hold.id)}>
      <span className={styles.rowTop}>
        <span className={styles.rowTitle}>{hold.scope === 'request' && hold.request ? hold.request.title : hold.account.display_id}</span>
        <Pill tone={hold.scope === 'account' ? 'blue' : 'grey'}>{t(`admin.holds.scope.${hold.scope}`)}</Pill>
        {hold.account.deleted && <Pill tone="grey">{t('admin.holds.accountDeleted')}</Pill>}
      </span>
      <span className={styles.rowMeta}>
        {hold.scope === 'request' && <span className={styles.id}>{hold.account.display_id}</span>}
        <span>{basisLabel(t, hold.basis)}</span>
        <span>{hold.reference}</span>
      </span>
      <span className={styles.rowMeta}>
        <ReviewLine hold={hold} />
        <span>{t('admin.holds.requestsCount', { count: hold.requests })}</span>
        <span>{t('admin.holds.detail.who', { who: who(hold.responsible), date: dateTime(lang, hold.created_at) })}</span>
      </span>
    </RowLink>
  );
}

/**
 * Suport → Păstrare legală (A3c2a): the active holds (reviews due first, in red once overdue) or
 * the released ones, and a new hold on an account. Admin only.
 */
export function LegalHoldsScreen() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const view = params.get('stare') === 'ridicate' ? 'released' : 'active';
  const load = useCallback(() => listLegalHolds(view), [view]);
  const { state, reload } = useLoad(load);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className={styles.page}>
      <BackLink to={ZONE_BACK.to} label={t(ZONE_BACK.label)} />
      <div>
        <h1>{t('admin.holds.title')}</h1>
      </div>

      <section className={styles.section}>
        <SectionTitle>{t('admin.holds.new.title')}</SectionTitle>
        <Card className={styles.stack}>
          <p className={styles.muted}>{t('admin.holds.new.desc')}</p>
          <HoldForm
            onPlaced={() => {
              setNotice(t('admin.holds.placed'));
              if (view === 'active') reload();
              else setParams({}, { replace: true });
            }}
          />
        </Card>
        {notice && (
          <p className={supportStyles.notice} role="status">
            {notice}
          </p>
        )}
      </section>

      <section className={styles.section}>
        <ViewSelect<'active' | 'released'>
          items={[
            { key: 'active', label: t('admin.holds.active') },
            { key: 'released', label: t('admin.holds.released') },
          ]}
          value={view}
          onChange={(k) => setParams(k === 'released' ? { stare: 'ridicate' } : {}, { replace: true })}
        />
        {state.status === 'loading' && <SkeletonList />}
        {state.status === 'error' && <LoadError message={t('admin.holds.loadError')} onRetry={reload} />}
        {state.status === 'ready' && (
          <>
            {view === 'active' && state.data.due > 0 && (
              <p className={styles.danger} role="status">
                {t('admin.holds.dueCount', { count: state.data.due })}
              </p>
            )}
            {state.data.items.length === 0 ? (
              <EmptyState icon={FileLock} title={t(view === 'active' ? 'admin.holds.empty' : 'admin.holds.emptyReleased')} />
            ) : (
              <ul className={styles.list}>
                {state.data.items.map((h) => (
                  <li key={h.id}>
                    <HoldRow hold={h} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** One hold: what it covers, why, who answers for it, its reviews, the author's identifiers. */
export function LegalHoldScreen() {
  const { t, lang } = useI18n();
  const { holdId = '' } = useParams();
  const valid = UUID.test(holdId);
  const load = useCallback(() => (valid ? getLegalHold(holdId) : Promise.reject(new Error('invalid id'))), [valid, holdId]);
  const { state, reload, setData } = useLoad(load);
  const [notice, setNotice] = useState<string | null>(null);
  const back = { to: ADMIN_HOLDS_PATH, label: t('admin.holds.title') };

  const refresh = useCallback(async () => {
    const fresh = await getLegalHold(holdId).catch(() => null);
    if (fresh) setData(() => fresh);
  }, [holdId, setData]);

  if (!valid || (state.status === 'error' && toRpcError(state.error).code === 'hold_not_found')) return <NotFound inShell />;
  if (state.status !== 'ready') {
    return (
      <div className={styles.page}>
        <BackLink to={back.to} label={back.label} />
        <h1>{t('admin.holds.title')}</h1>
        {state.status === 'loading' ? <SkeletonList count={3} /> : <LoadError message={t('admin.holds.detail.loadError')} onRetry={reload} />}
      </div>
    );
  }
  const h = state.data;
  const active = h.released_at === null;

  return (
    <div className={styles.page}>
      <BackLink to={back.to} label={back.label} />
      <div>
        <h1>{t('admin.holds.title')}</h1>
        <div className={styles.rowTop}>
          <Pill tone={active ? 'amber' : 'grey'}>{t(active ? 'admin.holds.active' : 'admin.holds.released')}</Pill>
          <Pill tone={h.scope === 'account' ? 'blue' : 'grey'}>{t(`admin.holds.scope.${h.scope}`)}</Pill>
        </div>
      </div>
      {notice && (
        <p className={supportStyles.notice} role="status">
          {notice}
        </p>
      )}

      <Card>
        <dl className={styles.facts}>
          <dt>{t('admin.holds.detail.account')}</dt>
          <dd>
            <span className={styles.id}>{h.account.display_id}</span>
            {h.account.deleted && <span className={styles.muted}> · {t('admin.holds.accountDeleted')}</span>}
          </dd>
          {h.request && (
            <>
              <dt>{t('admin.holds.detail.request')}</dt>
              <dd>
                <Link className={styles.link} to={adminRequestPath(h.request.id)}>
                  {h.request.title}
                </Link>
              </dd>
            </>
          )}
          <dt>{t('admin.holds.detail.basis')}</dt>
          <dd>{basisLabel(t, h.basis)}</dd>
          <dt>{t('admin.holds.detail.reason')}</dt>
          <dd>{h.reason}</dd>
          <dt>{t('admin.holds.detail.reference')}</dt>
          <dd>{h.reference}</dd>
          <dt>{t('admin.holds.detail.responsible')}</dt>
          <dd>{who(h.responsible)}</dd>
          <dt>{t('admin.holds.detail.created')}</dt>
          <dd>{t('admin.holds.detail.who', { who: who(h.created_by), date: dateTime(lang, h.created_at) })}</dd>
          {active ? (
            <>
              <dt>{t('admin.holds.detail.review')}</dt>
              <dd className={reviewOverdue(h) ? styles.danger : undefined}>
                {day(lang, h.review_due_at)}
                {reviewOverdue(h) && ` · ${t('admin.holds.overdue')}`}
              </dd>
            </>
          ) : (
            <>
              <dt>{t('admin.holds.detail.releasedBy')}</dt>
              <dd>{t('admin.holds.detail.who', { who: who(h.released_by), date: dateTime(lang, h.released_at) })}</dd>
              <dt>{t('admin.holds.detail.releaseReason')}</dt>
              <dd>{h.release_reason}</dd>
            </>
          )}
        </dl>
      </Card>

      {h.subject && <Subject subject={h.subject} />}

      <section className={styles.section}>
        <SectionTitle>{t('admin.holds.detail.covered')}</SectionTitle>
        {h.covered.length === 0 ? (
          <p className={styles.muted}>{t('admin.holds.detail.coveredEmpty')}</p>
        ) : (
          <ul className={styles.list}>
            {h.covered.map((r) => (
              <li key={r.id}>
                <RowLink to={adminRequestPath(r.id)}>
                  <span className={styles.rowTop}>
                    <span className={styles.rowTitle}>{r.title}</span>
                    <RequestStatusPill status={r.status} staff />
                  </span>
                  <span className={styles.rowMeta}>
                    <span>{day(lang, r.created_at)}</span>
                    {r.author_deleted && <span>{t('admin.holds.accountDeleted')}</span>}
                  </span>
                </RowLink>
              </li>
            ))}
          </ul>
        )}
      </section>

      {active && (
        <ReviewForm
          hold={h}
          onDone={async (next) => {
            setNotice(t('admin.holds.review.done', { date: day(lang, next) }));
            await refresh();
          }}
        />
      )}

      <section className={styles.section}>
        <SectionTitle>{t('admin.holds.detail.reviews')}</SectionTitle>
        {h.reviews.length === 0 ? (
          <p className={styles.muted}>{t('admin.holds.detail.reviewsEmpty')}</p>
        ) : (
          <ul className={styles.list}>
            {h.reviews.map((r) => (
              <li key={r.at}>
                <Card>
                  <span className={styles.rowMeta}>
                    <span>{t('admin.holds.detail.who', { who: who(r.by), date: dateTime(lang, r.at) })}</span>
                    <span>{t('admin.holds.reviewDue', { date: day(lang, r.next_due_at) })}</span>
                  </span>
                  <p>{r.note}</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {active && (
        <ReleaseAction
          hold={h}
          onDone={async (res) => {
            setNotice(t('admin.holds.release.done', { requests: res.deleted_requests, files: res.deleted_files }));
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function Subject({ subject }: { subject: NonNullable<LegalHoldDetail['subject']> }) {
  const { t, lang } = useI18n();
  return (
    <section className={styles.section}>
      <SectionTitle>{t('admin.holds.detail.subject')}</SectionTitle>
      <Card>
        <dl className={styles.facts}>
          <dt>{t('admin.holds.detail.account')}</dt>
          <dd className={styles.id}>{subject.display_id}</dd>
          <dt>{t('admin.holds.detail.name')}</dt>
          <dd>{subject.name || '—'}</dd>
          <dt>{t('admin.holds.detail.email')}</dt>
          <dd>{subject.email || '—'}</dd>
          <dt>{t('admin.holds.detail.phone')}</dt>
          <dd className="mono">{subject.phone || '—'}</dd>
        </dl>
        <p className={styles.muted}>
          {t('admin.holds.detail.captured', { date: dateTime(lang, subject.captured_at) })}
          {subject.account_deleted_at && ` · ${t('admin.holds.detail.accountDeletedOn', { date: dateTime(lang, subject.account_deleted_at) })}`}
        </p>
      </Card>
    </section>
  );
}

function ReviewForm({ hold, onDone }: { hold: LegalHoldDetail; onDone: (nextDue: string) => Promise<void> }) {
  const { t, lang } = useI18n();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <section className={styles.section}>
      <SectionTitle>{t('admin.holds.review.title')}</SectionTitle>
      <Card>
        <form className={supportStyles.form} noValidate onSubmit={(e) => e.preventDefault()}>
          <p className={styles.muted}>{t('admin.holds.review.desc')}</p>
          <TextArea
            label={t('admin.holds.review.note')}
            rows={3}
            maxLength={HOLD_TEXT_MAX}
            value={note}
            error={error}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
          />
          <ActionButton
            submit
            onAction={async (requestId) => {
              if (note.trim().length < HOLD_TEXT_MIN) {
                setError(t('admin.holds.err.noteShort'));
                return;
              }
              let next: string;
              try {
                next = (await reviewLegalHold(hold.id, note.trim(), null, requestId)).review_due_at;
              } catch (e) {
                const err = holdError(lang, e);
                if (err.field === 'note') {
                  setError(err.message);
                  return;
                }
                throw e;
              }
              setNote('');
              await onDone(next);
            }}
            errorMessage={(e) => holdError(lang, e).message}
            canRetry={canRetryRpc}
          >
            {t('admin.holds.review.submit')}
          </ActionButton>
        </form>
      </Card>
    </section>
  );
}

function ReleaseAction({
  hold,
  onDone,
}: {
  hold: LegalHoldDetail;
  onDone: (res: { deleted_requests: number; deleted_files: number }) => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <section className={styles.section}>
      {confirming ? (
        <ConfirmPanel
          title={t('admin.holds.release')}
          body={t('admin.holds.release.confirm')}
          textLabel={t('admin.holds.release.reason')}
          textHint={t('admin.holds.field.reasonHint')}
          textRequired
          confirmLabel={t('admin.holds.release')}
          danger
          errorMessage={(e) => holdError(lang, e).message}
          onConfirm={async (reason, requestId) => {
            const res = await releaseLegalHold(hold.id, reason, requestId);
            setConfirming(false);
            await onDone(res);
          }}
          onCancel={() => {
            setConfirming(false);
            requestAnimationFrame(() => ref.current?.focus());
          }}
        />
      ) : (
        <div className={supportStyles.actions}>
          <Button ref={ref} variant="secondary" onClick={() => setConfirming(true)}>
            {t('admin.holds.release')}
          </Button>
        </div>
      )}
    </section>
  );
}
