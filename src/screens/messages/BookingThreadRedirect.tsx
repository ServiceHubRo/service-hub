import { MessageSquare } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { BackLink } from '../../components/BackLink';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { Spinner } from '../../components/Spinner';
import { bookingThread } from '../../data/messages';
import { toRpcError } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import { messagesPath, threadPath } from './paths';
import { useThreads } from './threadsContext';
import styles from './messages.module.css';

/**
 * The "Mesaj" button of a booking card lands here: the booking's conversation is looked up and
 * this address is replaced by it, so Back returns to the booking list.
 */
export function BookingThreadRedirect() {
  const { t } = useI18n();
  const { bookingId = '' } = useParams();
  const { side, refresh } = useThreads();
  const load = useCallback(() => bookingThread(bookingId), [bookingId]);
  const { state, reload } = useLoad(load);

  // The conversation may be newer than the list (a booking just made on another device).
  const found = state.status === 'ready';
  useEffect(() => {
    if (found) refresh();
  }, [found, refresh]);

  if (state.status === 'ready') return <Navigate to={threadPath(side, state.data)} replace />;
  return (
    <div className={styles.page}>
      <BackLink to={messagesPath(side)} label={t('nav.messages')} />
      {state.status === 'loading' && (
        <div className={styles.center}>
          <Spinner size={24} label={t('common.loading')} />
        </div>
      )}
      {state.status === 'error' &&
        (['thread_not_found', 'booking_not_found'].includes(toRpcError(state.error).code) ? (
          <EmptyState icon={MessageSquare} title={t('msg.notFound')} />
        ) : (
          <LoadError message={t('msg.loadConversationError')} onRetry={reload} />
        ))}
    </div>
  );
}
