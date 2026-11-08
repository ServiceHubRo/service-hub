import { useCallback, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSession } from '../../app/sessionContext';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { TextArea } from '../../components/TextArea';
import { canRetryRpc, rpcErrorMessage, toRpcError } from '../../data/rpc';
import {
  addNote,
  assignRequest,
  escalateRequest,
  fetchSupportCategories,
  getRequest,
  listStaff,
  REQUEST_BODY_MAX,
  replyRequest,
  returnRequest,
  setRequestStatus,
  settableStatuses,
  takeRequest,
  type RequestStatus,
  type StaffRef,
  type StaffRequestDetail,
} from '../../data/supportRequests';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { ro } from '../../i18n/ro';
import { useLoad } from '../../lib/useLoad';
import { ConfirmPanel } from '../admin/ActionPanels';
import { ADMIN_REQUESTS_PATH, adminClientPath } from '../admin/paths';
import adminStyles from '../admin/admin.module.css';
import { NotFound } from '../public/NotFound';
import { SUPPORT_REQUESTS_PATH, supportAccountPath } from '../support/paths';
import { categoryName, dayText, whenText } from './format';
import { AttachmentPicker } from './Attachments';
import { Conversation, RequestStatusPill, type ConversationItem } from './parts';
import styles from './requests.module.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const staffName = (s: Partial<StaffRef> | null | undefined) => [s?.display_id, s?.name].filter(Boolean).join(' · ');

/**
 * One request for the team (A3a): who wrote it (as an agent may see the account), the booking's
 * minimal reference, the conversation with which member answered, the internal notes (never the
 * author's), and the work: take, assign, answer, change the state, note, escalate (agent) or give back
 * (admin). An escalated request is read-only for an agent; a closed one for everybody. Every opening
 * and every action is in the audit log (the database writes it).
 */
export function RequestScreen({ mode }: { mode: 'support' | 'admin' }) {
  const { t, lang } = useI18n();
  const session = useSession();
  const me = session.profile?.id ?? '';
  const { requestId = '' } = useParams();
  const valid = UUID.test(requestId);
  const load = useCallback(
    () => (valid ? Promise.all([getRequest(requestId), fetchSupportCategories(), listStaff()]) : Promise.reject(new Error('invalid id'))),
    [valid, requestId],
  );
  const { state, reload, setData } = useLoad(load);
  const back = { to: mode === 'admin' ? ADMIN_REQUESTS_PATH : SUPPORT_REQUESTS_PATH, label: t('support.requests.title') };

  // After an action: the request again, quietly (no skeleton; the page stays where it is).
  const refresh = useCallback(async () => {
    const fresh = await getRequest(requestId).catch(() => null);
    if (fresh) setData(([, cats, staff]) => [fresh, cats, staff]);
  }, [requestId, setData]);

  if (!valid || (state.status === 'error' && toRpcError(state.error).code === 'request_not_found')) return <NotFound inShell />;
  if (state.status !== 'ready') {
    return (
      <div className={adminStyles.page}>
        <PageHeader back={back} title={t('support.requests.title')} />
        {state.status === 'loading' ? <SkeletonList count={3} /> : <LoadError message={t('support.detail.loadError')} onRetry={reload} />}
      </div>
    );
  }

  const [r, categories, staff] = state.data;
  const closed = r.status === 'closed';
  const escalated = r.escalated_at !== null;
  const editable = !closed && (mode === 'admin' || !escalated);
  const authorName = r.author ? [r.author.display_id, r.author.name].filter(Boolean).join(' · ') : t('support.detail.deletedAuthor');
  const items: ConversationItem[] = [
    { id: 'first', side: 'author', who: authorName, when: whenText(lang, r.created_at), body: r.body, files: r.files.filter((f) => !f.message_id) },
    ...r.messages.map((m) => ({
      files: r.files.filter((f) => f.message_id === m.id),
      id: m.id,
      side: m.from_staff ? ('team' as const) : ('author' as const),
      who: m.from_staff ? staffName(m.by) || t('support.req.team') : authorName,
      when: whenText(lang, m.created_at),
      body: m.body,
    })),
  ];
  const authorLink =
    r.author && r.author.state !== 'deleted'
      ? mode === 'admin'
        ? r.author.role === 'client'
          ? adminClientPath(r.author.id)
          : null
        : supportAccountPath(r.author.id)
      : null;
  const bookingStatus = r.booking && `status.${r.booking.status}` in ro ? t(`status.${r.booking.status}` as MessageKey) : r.booking?.status;

  return (
    <div className={adminStyles.page}>
      <PageHeader back={back} title={r.title} />
      <div className={styles.meta}>
        <RequestStatusPill status={r.status} staff />
        {escalated && <span className={`${styles.pill} ${styles.red}`}>{t('support.inbox.escalated')}</span>}
        <span>{categoryName(categories, r.category, lang)}</span>
      </div>

      {escalated && (
        <div className={styles.banner} data-tone="escalated" role="note">
          <strong>{t('support.detail.escalatedBanner', { who: staffName(r.escalated_by) || '—', date: whenText(lang, r.escalated_at!) })}</strong>
          {r.escalation_reason && <span>{t('support.detail.escalatedReason', { reason: r.escalation_reason })}</span>}
          {mode === 'support' && <span className={styles.muted}>{t('support.detail.escalatedAgent')}</span>}
          {mode === 'admin' && <ReturnAction request={r} onDone={refresh} />}
        </div>
      )}

      <Card>
        <dl className={styles.facts}>
          <dt>{t('support.detail.author')}</dt>
          <dd>
            {authorLink ? (
              <Link to={authorLink} className={styles.factLink}>
                {authorName}
              </Link>
            ) : (
              authorName
            )}
            {r.author?.email_masked && <span className={styles.muted}> · {r.author.email_masked}</span>}
          </dd>
          <dt>{t('support.detail.created')}</dt>
          <dd>{whenText(lang, r.created_at)}</dd>
          {r.booking && (
            <>
              <dt>{t('support.detail.booking')}</dt>
              <dd>
                <span className="mono">{r.booking.ref}</span> · {dayText(lang, r.booking.date)} · {r.booking.shop_name} · {bookingStatus}
              </dd>
            </>
          )}
          <dt>{t('support.detail.responsible')}</dt>
          <dd>{r.assigned ? staffName(r.assigned) : t('support.inbox.unassigned')}</dd>
        </dl>
        {editable && <Responsible request={r} me={me} staff={staff} onDone={refresh} />}
      </Card>

      <section className={styles.form} aria-label={t('support.req.conversation')}>
        <h2 className={adminStyles.sectionTitle}>{t('support.req.conversation')}</h2>
        <Conversation items={items} label={t('support.req.conversation')} showOpens={mode === 'admin'} />
      </section>

      {closed && <p className={styles.muted}>{t('support.detail.closedNote')}</p>}
      {editable && r.author && <ReplyForm request={r} onDone={refresh} />}
      {editable && <StatusForm request={r} onDone={refresh} />}

      <Notes request={r} canWrite={mode === 'admin' || !escalated} onDone={refresh} />

      {mode === 'support' && editable && <EscalateAction request={r} onDone={refresh} />}
    </div>
  );
}

function Responsible({ request, me, staff, onDone }: { request: StaffRequestDetail; me: string; staff: StaffRef[]; onDone: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const others = staff.filter((s) => s.id !== request.assigned?.id);
  const [to, setTo] = useState(others[0]?.id ?? '');
  const chosen = others.some((s) => s.id === to) ? to : (others[0]?.id ?? '');
  return (
    <div className={styles.actions} style={{ marginTop: 12 }}>
      {request.assigned?.id !== me && (
        <ActionButton
          variant="secondary"
          block={false}
          onAction={async (requestId) => {
            await takeRequest(request.id, requestId);
            await onDone();
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('support.detail.take')}
        </ActionButton>
      )}
      {others.length > 0 && (
        <>
          <SelectField
            label={t('support.detail.assignTo')}
            value={chosen}
            onChange={(e) => setTo(e.target.value)}
            options={others.map((s) => ({ value: s.id, label: staffName(s) }))}
          />
          <ActionButton
            variant="secondary"
            block={false}
            onAction={async (requestId) => {
              await assignRequest(request.id, chosen, requestId);
              await onDone();
            }}
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            canRetry={canRetryRpc}
          >
            {t('support.detail.assign')}
          </ActionButton>
        </>
      )}
    </div>
  );
}

function ReplyForm({ request, onDone }: { request: StaffRequestDetail; onDone: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const [text, setText] = useState('');
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [pickerKey, setPickerKey] = useState(0);
  const [after, setAfter] = useState<RequestStatus | ''>(request.category === 'suggestions' ? '' : 'waiting_user');
  return (
    <Card>
      <form className={styles.form} noValidate onSubmit={(e) => e.preventDefault()}>
        <TextArea
          label={t('support.detail.reply')}
          hint={t('support.detail.replyHint')}
          rows={4}
          maxLength={REQUEST_BODY_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <SelectField
          label={t('support.detail.after')}
          value={after}
          onChange={(e) => setAfter(e.target.value as RequestStatus | '')}
          options={[
            { value: '', label: t('support.detail.keep') },
            ...settableStatuses(request.category)
              .filter((s) => s !== 'closed' && s !== request.status)
              .map((s) => ({ value: s, label: t(`support.staffStatus.${s}`) })),
          ]}
        />
        <AttachmentPicker key={pickerKey} onChange={setFileIds} />
        <ActionButton
          submit
          disabled={!text.trim()}
          onAction={async (requestId) => {
            await replyRequest(request.id, text.trim(), after || null, requestId, fileIds);
            setText('');
            setFileIds([]);
            setPickerKey((k) => k + 1);
            await onDone();
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('support.detail.sendReply')}
        </ActionButton>
      </form>
    </Card>
  );
}

function StatusForm({ request, onDone }: { request: StaffRequestDetail; onDone: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const options = settableStatuses(request.category).filter((s) => s !== request.status);
  const [next, setNext] = useState<RequestStatus>(options[0]!);
  const chosen = options.includes(next) ? next : options[0]!;
  return (
    <div className={styles.actions}>
      <SelectField
        label={t('support.detail.status')}
        value={chosen}
        onChange={(e) => setNext(e.target.value as RequestStatus)}
        options={options.map((s) => ({ value: s, label: t(`support.staffStatus.${s}`) }))}
      />
      <ActionButton
        variant="secondary"
        block={false}
        onAction={async (requestId) => {
          await setRequestStatus(request.id, chosen, requestId);
          await onDone();
        }}
        errorMessage={(e) => rpcErrorMessage(lang, e)}
        canRetry={canRetryRpc}
      >
        {t('support.detail.setStatus')}
      </ActionButton>
    </div>
  );
}

function Notes({ request, canWrite, onDone }: { request: StaffRequestDetail; canWrite: boolean; onDone: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const [text, setText] = useState('');
  return (
    <section className={styles.notes} aria-label={t('support.detail.notes')}>
      <h2 className={adminStyles.sectionTitle}>{t('support.detail.notes')}</h2>
      <p className={styles.muted}>{t('support.detail.notesHint')}</p>
      {request.notes.length === 0 ? (
        <p className={styles.muted}>{t('support.detail.noNotes')}</p>
      ) : (
        <ul className={styles.list}>
          {request.notes.map((n) => (
            <li key={n.id} className={styles.note}>
              <span className={styles.messageHead}>
                <span className={styles.messageWho}>{staffName(n.by)}</span>
                <span>{whenText(lang, n.created_at)}</span>
              </span>
              <p className={styles.messageBody}>{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form className={styles.form} noValidate onSubmit={(e) => e.preventDefault()}>
          <TextArea label={t('support.detail.noteField')} rows={3} maxLength={REQUEST_BODY_MAX} value={text} onChange={(e) => setText(e.target.value)} />
          <ActionButton
            submit
            variant="secondary"
            disabled={!text.trim()}
            onAction={async (requestId) => {
              await addNote(request.id, text.trim(), requestId);
              setText('');
              await onDone();
            }}
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            canRetry={canRetryRpc}
          >
            {t('support.detail.addNote')}
          </ActionButton>
        </form>
      )}
    </section>
  );
}

function EscalateAction({ request, onDone }: { request: StaffRequestDetail; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return open ? (
    <ConfirmPanel
      title={t('support.detail.escalate')}
      body={t('support.detail.escalateBody')}
      textLabel={t('support.detail.reason')}
      textRequired
      confirmLabel={t('support.detail.escalate')}
      danger
      onConfirm={async (reason, requestId) => {
        await escalateRequest(request.id, reason, requestId);
        setOpen(false);
        await onDone();
      }}
      onCancel={() => {
        setOpen(false);
        requestAnimationFrame(() => ref.current?.focus());
      }}
    />
  ) : (
    <div className={styles.actions}>
      <Button ref={ref} variant="secondary" onClick={() => setOpen(true)}>
        {t('support.detail.escalate')}
      </Button>
    </div>
  );
}

function ReturnAction({ request, onDone }: { request: StaffRequestDetail; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return open ? (
    <ConfirmPanel
      title={t('support.detail.return')}
      body={t('support.detail.returnBody')}
      textLabel={t('support.detail.reason')}
      textRequired
      confirmLabel={t('support.detail.return')}
      onConfirm={async (reason, requestId) => {
        await returnRequest(request.id, reason, requestId);
        setOpen(false);
        await onDone();
      }}
      onCancel={() => {
        setOpen(false);
        requestAnimationFrame(() => ref.current?.focus());
      }}
    />
  ) : (
    <div className={styles.actions}>
      <Button ref={ref} variant="secondary" onClick={() => setOpen(true)}>
        {t('support.detail.return')}
      </Button>
    </div>
  );
}
