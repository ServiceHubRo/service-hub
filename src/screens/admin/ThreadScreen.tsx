import { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackLink } from '../../components/BackLink';
import { Card } from '../../components/Card';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { fetchThread } from '../../data/admin';
import { useI18n } from '../../i18n/context';
import { Conversation } from './Conversation';
import { ADMIN_CLIENTS_PATH, adminClientPath, adminShopPath } from './paths';
import { useLiveData } from './useLiveData';
import styles from './admin.module.css';

/** Mesaje (FR §5.8): any client–shop conversation, read-only, for disputes. Live. */
export function ThreadScreen() {
  const { threadId = '' } = useParams();
  const { t } = useI18n();
  const load = useCallback(() => fetchThread(threadId), [threadId]);
  const { state, reload } = useLiveData(load, [{ table: 'messages', filter: `thread_id=eq.${threadId}` }], `admin-thread:${threadId}`);

  if (state.status === 'loading') return <SkeletonList />;
  if (state.status === 'error') {
    return (
      <div className={styles.page}>
        <BackLink to={ADMIN_CLIENTS_PATH} label={t('nav.admin.clients')} />
        <LoadError message={t('admin.loadError')} onRetry={reload} />
      </div>
    );
  }
  const { thread, messages } = state.data;
  const clientName = thread.client_name || t('admin.deletedAccount');
  return (
    <div className={styles.page}>
      <BackLink to={thread.client_id ? adminClientPath(thread.client_id) : ADMIN_CLIENTS_PATH} label={t('common.back')} />
      <h1>{t('admin.thread.title')}</h1>
      <Card className={styles.stack}>
        <span className={styles.rowMeta}>
          <Link className={styles.link} to={adminShopPath(thread.shop_id)}>
            {thread.shop_name}
          </Link>
          {thread.client_id ? (
            <Link className={styles.link} to={adminClientPath(thread.client_id)}>
              {clientName}
              {thread.client_display_id ? ` · ${thread.client_display_id}` : ''}
            </Link>
          ) : (
            <span>{clientName}</span>
          )}
        </span>
        <p className={styles.muted}>{t('admin.thread.readOnly')}</p>
      </Card>
      <Conversation messages={messages} shopName={thread.shop_name} clientName={clientName} />
    </div>
  );
}
