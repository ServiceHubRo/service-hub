import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { Card } from '../../components/Card';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SkeletonList } from '../../components/Skeleton';
import { TextArea } from '../../components/TextArea';
import { canRetryRpc, rpcErrorMessage, toRpcError } from '../../data/rpc';
import { fetchMyRequest, fetchSupportCategories, REQUEST_BODY_MAX, replyMyRequest } from '../../data/supportRequests';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import { NotFound } from '../public/NotFound';
import accountStyles from '../account/account.module.css';
import { newRequestPath, requestsPath } from '../account/paths';
import { categoryName, dayText, whenText } from './format';
import { Conversation, RequestStatusPill, type ConversationItem } from './parts';
import styles from './requests.module.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One of the author's requests (A3a): its state, the booking it is about, the conversation with
 * „Echipa Service-Hub” (never who answered, never the team's notes) and a new message. A message within
 * 14 days of „Rezolvată” reopens it; a closed one points to a new request.
 */
export function MyRequestScreen({ role }: { role: 'client' | 'shop' }) {
  const { t, lang } = useI18n();
  const { requestId = '' } = useParams();
  const valid = UUID.test(requestId);
  const load = useCallback(
    () => (valid ? Promise.all([fetchMyRequest(requestId), fetchSupportCategories()]) : Promise.reject(new Error('invalid id'))),
    [valid, requestId],
  );
  const { state, reload, setData } = useLoad(load);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const back = { to: requestsPath(role), label: t('support.my.title') };

  if (!valid || (state.status === 'error' && toRpcError(state.error).code === 'request_not_found')) return <NotFound inShell />;

  if (state.status !== 'ready') {
    return (
      <div className={accountStyles.page}>
        <PageHeader back={back} title={t('support.my.title')} />
        {state.status === 'loading' ? <SkeletonList count={2} /> : <LoadError message={t('support.req.loadError')} onRetry={reload} />}
      </div>
    );
  }

  const [r, categories] = state.data;
  const items: ConversationItem[] = [
    { id: 'first', side: 'author', who: t('support.req.me'), when: whenText(lang, r.created_at), body: r.body },
    ...r.messages.map((m) => ({
      id: m.id,
      side: m.from_staff ? ('team' as const) : ('author' as const),
      who: m.from_staff ? t('support.req.team') : t('support.req.me'),
      when: whenText(lang, m.created_at),
      body: m.body,
    })),
  ];

  return (
    <div className={accountStyles.page}>
      <PageHeader back={back} title={r.title} />
      <div className={styles.meta}>
        <RequestStatusPill status={r.status} />
        <span>{categoryName(categories, r.category, lang)}</span>
        {r.booking && (
          <span>
            {t('support.req.booking', { ref: r.booking.ref, date: dayText(lang, r.booking.date), shop: r.booking.shop_name })}
          </span>
        )}
      </div>

      <section className={styles.form} aria-label={t('support.req.conversation')}>
        <Conversation items={items} label={t('support.req.conversation')} />
      </section>

      {r.can_reply ? (
        <Card>
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
            <ActionButton
              submit
              disabled={!text.trim()}
              onAction={async (requestId) => {
                await replyMyRequest(r.id, text.trim(), requestId);
                // The conversation again, quietly: no skeleton, the page stays where it is.
                const fresh = await fetchMyRequest(r.id).catch(() => null);
                setText('');
                setSent(true);
                if (fresh) setData(([, cats]) => [fresh, cats]);
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
        </Card>
      ) : (
        <p className={styles.muted}>
          {t('support.req.closed')} <Link to={newRequestPath(role)}>{t('support.my.new')}</Link>
        </p>
      )}
    </div>
  );
}
