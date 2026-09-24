import { MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { ShopAvatar } from '../../components/ShopAvatar';
import { SkeletonList } from '../../components/Skeleton';
import type { ThreadSummary } from '../../data/messages';
import { useI18n } from '../../i18n/context';
import { formatListTime, systemMessageText, type Side } from '../../lib/messages';
import { useNow } from '../../lib/useNow';
import { threadPath } from './paths';
import { useThreads } from './threadsContext';
import styles from './messages.module.css';

/** The other side's name as the reader sees it; a deleted client account has none. */
export function counterpartName(t: (key: 'msg.deletedAccount') => string, side: Side, thread: ThreadSummary): string {
  if (side === 'client') return thread.shop_name;
  return thread.client_name?.trim() || t('msg.deletedAccount');
}

/** The avatar: the shop's logo or initials for a client; the client's initials for a shop. */
export function ThreadAvatar({ side, thread, size = 44 }: { side: Side; thread: ThreadSummary; size?: number }) {
  const { t } = useI18n();
  return side === 'client' ? (
    <ShopAvatar name={thread.shop_name} logoUrl={thread.shop_logo_url} size={size} />
  ) : (
    <ShopAvatar name={counterpartName(t, side, thread)} logoUrl={null} size={size} />
  );
}

/**
 * Mesaje (FR §3.7, §4.4, P9): one conversation per client–shop pair, the newest message on top,
 * with the last message and the number of unread messages. Live through ThreadsProvider.
 */
export function MessagesScreen() {
  const { t, lang } = useI18n();
  const { side, state, reload } = useThreads();
  const now = useNow();

  return (
    <div className={styles.page}>
      <h1>{t('nav.messages')}</h1>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('msg.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (state.data.threads.length === 0 ? (
          <EmptyState icon={MessageSquare} title={t('msg.empty')} body={t(side === 'client' ? 'msg.emptyBody.client' : 'msg.emptyBody.shop')} />
        ) : (
          <ul className={styles.threadList}>
            {state.data.threads.map((thread) => {
              const name = counterpartName(t, side, thread);
              const preview =
                thread.last_kind === 'system'
                  ? systemMessageText(lang, side, thread.last_event, thread.last_params)
                  : thread.last_kind === 'user'
                    ? `${thread.last_own ? `${t('msg.you')}: ` : ''}${thread.last_body ?? ''}`
                    : '';
              const unread = thread.unread > 0;
              return (
                <li key={thread.thread_id}>
                  <Link to={threadPath(side, thread.thread_id)} className={`${styles.thread} ${unread ? styles.threadUnread : ''}`}>
                    <ThreadAvatar side={side} thread={thread} />
                    <span className={styles.threadText}>
                      <span className={styles.threadTop}>
                        <span className={styles.threadName}>{name}</span>
                        {thread.last_message_at && (
                          <span className={`mono ${styles.threadTime}`}>{formatListTime(lang, thread.last_message_at, now)}</span>
                        )}
                      </span>
                      <span className={styles.threadBottom}>
                        <span className={styles.preview}>{preview}</span>
                        {unread && (
                          <span className={styles.unread}>
                            <span aria-hidden="true">{thread.unread > 99 ? '99+' : thread.unread}</span>
                            <span className="visually-hidden">{t('msg.unreadCount', { n: thread.unread })}</span>
                          </span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
