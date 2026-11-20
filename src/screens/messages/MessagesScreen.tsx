import { MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { DetailFrame, ListDetailLayout } from '../../components/ListDetailLayout';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SkeletonList } from '../../components/Skeleton';
import { useI18n } from '../../i18n/context';
import { counterpartName, formatListTime, systemMessageText } from '../../lib/messages';
import { useNow } from '../../lib/useNow';
import { useOptionalNotices } from '../notices/noticesContext';
import { TeamAvatar } from '../notices/TeamAvatar';
import { messagesPath, TEAM_ROW, teamPath, threadPath } from './paths';
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
export function MessagesScreen({ selectedId, detail, wide = false }: { selectedId?: string; detail?: ReactNode; wide?: boolean } = {}) {
  const { t, lang } = useI18n();
  const { side, state, reload } = useThreads();
  const now = useNow();
  const notices = useOptionalNotices();
  const [params] = useSearchParams();
  const pushed = params.get('anunt');
  const latest = notices?.notices[0];
  const newNotices = notices?.unread ?? 0;

  // A push sent before (`/mesaje?anunt=…`) goes to the team's conversation; beside the list that is already
  // the one shown, so it is not sent there again.
  if (pushed && selectedId !== TEAM_ROW) return <Navigate to={`${teamPath(side)}?anunt=${encodeURIComponent(pushed)}`} replace />;

  const header = <PageHeader title={t('nav.messages')} />;
  const hasThreads = state.status === 'ready' && state.data.threads.length > 0;

  const list = (
    <>
      {latest && (
        <Link
          to={teamPath(side)}
          aria-current={selectedId === TEAM_ROW ? 'true' : undefined}
          className={`${styles.thread} ${newNotices > 0 ? styles.threadUnread : ''} ${selectedId === TEAM_ROW ? styles.threadSelected : ''}`}
        >
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
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('msg.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (state.data.threads.length === 0 ? (
          <EmptyState icon={MessageSquare} title={t('msg.empty')} body={t(side === 'client' ? 'msg.emptyBody.client' : 'msg.emptyBody.shop')} />
        ) : (
          <ul className={styles.threadList}>
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
                  <Link
                    to={threadPath(side, thread.thread_id)}
                    aria-current={selectedId === thread.thread_id ? 'true' : undefined}
                    className={`${styles.thread} ${unread ? styles.threadUnread : ''} ${selectedId === thread.thread_id ? styles.threadSelected : ''}`}
                  >
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
    </>
  );

  // Beside the list, nothing is opened by itself: opening a conversation marks it read.
  const split = hasThreads || !!latest;
  if (wide && (detail || split))
    return (
      <div className={styles.page}>
        <ListDetailLayout
          wide
          open={false}
          backTo={messagesPath(side)}
          backLabel={t('nav.messages')}
          header={header}
          list={list}
          detail={
            detail ?? (
              <DetailFrame>
                <EmptyState icon={MessageSquare} title={t('msg.paneEmpty')} />
              </DetailFrame>
            )
          }
        />
      </div>
    );
  return (
    <div className={styles.page}>
      {header}
      {list}
    </div>
  );
}
