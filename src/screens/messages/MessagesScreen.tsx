import { MessageSquare } from 'lucide-react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { useI18n } from '../../i18n/context';
import { counterpartName, formatListTime, systemMessageText } from '../../lib/messages';
import { useNow } from '../../lib/useNow';
import { useOptionalNotices } from '../notices/noticesContext';
import { TeamAvatar } from '../notices/TeamAvatar';
import { teamPath, threadPath } from './paths';
import { ThreadAvatar } from './ThreadAvatar';
import { useThreads } from './threadsContext';
import styles from './messages.module.css';

/**
 * Mesaje (FR §3.7, §4.4, P9): one conversation per client–shop pair, the newest message on top,
 * with the last message and the number of unread messages. Live through ThreadsProvider.
 * Above them, while there are any, the notices from the Service-Hub team as one conversation
 * (Eduard, 23 Oct): the newest title and the number of new ones. A push about one opens it there
 * (`?anunt=<id>`, here too for the pushes sent before).
 */
export function MessagesScreen() {
  const { t, lang } = useI18n();
  const { side, state, reload } = useThreads();
  const now = useNow();
  const notices = useOptionalNotices();
  const [params] = useSearchParams();
  const pushed = params.get('anunt');
  const latest = notices?.notices[0];
  const newNotices = notices?.unread ?? 0;

  if (pushed) return <Navigate to={`${teamPath(side)}?anunt=${encodeURIComponent(pushed)}`} replace />;

  return (
    <div className={styles.page}>
      <h1>{t('nav.messages')}</h1>
      {latest && (
        <Link to={teamPath(side)} className={`${styles.thread} ${newNotices > 0 ? styles.threadUnread : ''}`}>
          <TeamAvatar />
          <span className={styles.threadText}>
            <span className={styles.threadTop}>
              <span className={styles.threadName}>{t('notices.from')}</span>
              <span className={`mono ${styles.threadTime}`}>{formatListTime(lang, latest.created_at, now)}</span>
            </span>
            <span className={styles.threadBottom}>
              <span className={styles.preview}>{lang === 'en' ? latest.title_en : latest.title_ro}</span>
              {newNotices > 0 && (
                <span className={styles.unread}>
                  <span aria-hidden="true">{newNotices}</span>
                  <span className="visually-hidden">{t('notices.newCount', { n: newNotices })}</span>
                </span>
              )}
            </span>
          </span>
        </Link>
      )}
      {state.status === 'loading' && <SkeletonList cards />}
      {state.status === 'error' && <LoadError message={t('msg.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (state.data.threads.length === 0 ? (
          <EmptyState icon={MessageSquare} title={t('msg.empty')} body={t(side === 'client' ? 'msg.emptyBody.client' : 'msg.emptyBody.shop')} />
        ) : (
          <ul className={styles.threadList} data-layout="cards">
            {state.data.threads.map((thread) => {
              const name = counterpartName(side, thread, t('msg.deletedAccount'));
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
