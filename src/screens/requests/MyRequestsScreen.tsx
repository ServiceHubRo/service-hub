import { Inbox, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClass } from '../../components/buttonClass';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SkeletonList } from '../../components/Skeleton';
import { fetchMyRequests, fetchSupportCategories } from '../../data/supportRequests';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import accountStyles from '../account/account.module.css';
import { helpPath, newRequestPath, requestPath } from '../account/paths';
import { categoryName, whenText } from './format';
import { RequestStatusPill } from './parts';
import { useAuthorSignals } from './useAuthorSignals';
import styles from './requests.module.css';

const load = () => Promise.all([fetchMyRequests(), fetchSupportCategories()]);

/**
 * Cont → Ajutor și contact → Solicitările mele (A3a): the author's requests, the ones with a new answer
 * marked, and „Solicitare nouă”. Live (A3c1): an answer or a new state appears without reloading.
 */
export function MyRequestsScreen({ role }: { role: 'client' | 'shop' }) {
  const { t, lang } = useI18n();
  const { state, reload, setData } = useLoad(load);
  useAuthorSignals(() => {
    if (state.status === 'ready') load().then(setData, () => {}); // what is on screen stays on a failure
  });

  return (
    <div className={accountStyles.page}>
      <PageHeader
        back={{ to: helpPath(role), label: t('help.title') }}
        title={t('support.my.title')}
        actions={
          <Link to={newRequestPath(role)} className={buttonClass('primary')}>
            <Plus size={18} aria-hidden="true" />
            {t('support.my.new')}
          </Link>
        }
      />
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('support.my.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (state.data[0].length === 0 ? (
          <EmptyState icon={Inbox} title={t('support.my.empty')} />
        ) : (
          <ul className={styles.list}>
            {state.data[0].map((r) => (
              <li key={r.id}>
                <Link to={requestPath(role, r.id)} className={styles.cardLink}>
                  <Card className={styles.row}>
                    <span className={styles.rowTop}>
                      <span className={styles.rowTitle}>{r.title}</span>
                      <RequestStatusPill status={r.status} />
                      {r.unread && <span className={`${styles.pill} ${styles.blue}`}>{t('support.my.unread')}</span>}
                    </span>
                    <span className={styles.meta}>
                      <span>{categoryName(state.data[1], r.category, lang)}</span>
                      <span>{t('support.my.sentOn', { date: whenText(lang, r.created_at) })}</span>
                    </span>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
