import { MessageSquare } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { DetailPane } from '../../components/ListDetailLayout';
import { ListRowsSkeleton } from '../../components/ListRow';
import { LoadError } from '../../components/LoadError';
import { TextArea } from '../../components/TextArea';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { fetchMyRequest, REQUEST_BODY_MAX, replyMyRequest, type SupportCategory } from '../../data/supportRequests';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import { newRequestPath } from '../account/paths';
import { AttachmentPicker } from './Attachments';
import { categoryName, dayText, whenText } from './format';
import { Conversation, RequestStatusPill, type ConversationItem } from './parts';
import styles from './requests.module.css';

/**
 * One of the author's requests in Solicitările mele (A3a, page template A since C7): its state, the
 * booking it is about, the conversation with „Echipa Service-Hub” (never who answered, never the team's
 * notes) and a new message. A message within 14 days of „Rezolvată” reopens it; a closed one points to
 * a new request. Live (A3c1): the team's answer and a new state appear; what is being typed stays.
 */
export function MyRequestDetail({
  role,
  requestId,
  categories,
  signal,
  onChanged,
}: {
  role: 'client' | 'shop';
  requestId: string;
  categories: SupportCategory[];
  /** Grows with each live signal the list receives (A3c1): the request is read again. */
  signal: number;
  /** The list again (its state, the „new answer” mark: opening a request reads its answers). */
  onChanged: () => void;
}) {
  const { t, lang } = useI18n();
  const load = useCallback(() => fetchMyRequest(requestId), [requestId]);
  const { state, reload, setData } = useLoad(load);
  // A live change: the request again, quietly (what is being typed stays).
  const seen = useRef(signal);
  useEffect(() => {
    if (seen.current === signal) return;
    seen.current = signal;
    fetchMyRequest(requestId).then(setData, () => {});
  }, [signal, requestId, setData]);
  // Opened: its answers are read now, so the list's „new answer” goes.
  const ready = state.status === 'ready';
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  });
  useEffect(() => {
    if (ready) changed.current();
  }, [ready]);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const [fileIds, setFileIds] = useState<string[]>([]);
  // A new picker after each message (its list empties).
  const [pickerKey, setPickerKey] = useState(0);

  if (state.status === 'loading') return <ListRowsSkeleton count={2} label={t('common.loading')} />;
  if (state.status === 'error') return <LoadError message={t('support.req.loadError')} onRetry={reload} />;

  const r = state.data;
  const items: ConversationItem[] = [
    { id: 'first', side: 'author', who: t('support.req.me'), when: whenText(lang, r.created_at), body: r.body, files: r.files.filter((f) => !f.message_id) },
    ...r.messages.map((m) => ({
      files: r.files.filter((f) => f.message_id === m.id),
      id: m.id,
      side: m.from_staff ? ('team' as const) : ('author' as const),
      who: m.from_staff ? t('support.req.team') : t('support.req.me'),
      when: whenText(lang, m.created_at),
      body: m.body,
    })),
  ];
  const line = [
    categoryName(categories, r.category, lang),
    r.booking ? t('support.req.booking', { ref: r.booking.ref, date: dayText(lang, r.booking.date), shop: r.booking.shop_name }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <DetailPane id={r.id} icon={<MessageSquare size={20} />} title={r.title} detail={line} status={<RequestStatusPill status={r.status} />}>
      <section className={styles.form} aria-label={t('support.req.conversation')}>
        <Conversation items={items} label={t('support.req.conversation')} />
      </section>
      {r.can_reply ? (
        <form className={styles.form} noValidate onSubmit={(e) => e.preventDefault()}>
          <TextArea
            label={t('support.req.reply')}
            rows={4}
            maxLength={REQUEST_BODY_MAX}
            value={text}
            hint={r.status === 'resolved' && r.reopen_until ? t('support.req.reopenUntil', { date: whenText(lang, r.reopen_until) }) : t('support.new.privacy')}
            onChange={(e) => {
              setText(e.target.value);
              setSent(false);
            }}
          />
          <AttachmentPicker key={pickerKey} onChange={setFileIds} />
          <ActionButton
            submit
            disabled={!text.trim()}
            onAction={async (requestId) => {
              await replyMyRequest(r.id, text.trim(), requestId, fileIds);
              // The conversation again, quietly: no skeleton, the page stays where it is.
              const fresh = await fetchMyRequest(r.id).catch(() => null);
              setText('');
              setSent(true);
              setFileIds([]);
              setPickerKey((k) => k + 1);
              if (fresh) setData(fresh);
              onChanged();
            }}
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            canRetry={canRetryRpc}
          >
            {t('support.req.send')}
          </ActionButton>
          {sent && (
            <p className={styles.notice} role="status">
              {t('support.req.sent')}
            </p>
          )}
        </form>
      ) : (
        <>
          <p className={styles.muted}>
            {t('support.req.closed')} <Link to={newRequestPath(role)}>{t('support.my.new')}</Link>
          </p>
          {r.status === 'closed' && <p className={styles.muted}>{t('support.files.closedNote')}</p>}
        </>
      )}
    </DetailPane>
  );
}
