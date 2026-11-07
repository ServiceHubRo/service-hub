import { useCallback, useState } from 'react';
import { adminZoneBack } from '../../app/adminZones';
import { BackLink } from '../../components/BackLink';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { fetchNoShowDisputes } from '../../data/noShows';
import { useI18n } from '../../i18n/context';
import type { Msg } from '../../i18n/translate';
import { NoShowDisputesSection } from './NoShowDisputes';
import { ADMIN_DISPUTES_PATH } from './paths';
import { useLiveData } from './useLiveData';
import styles from './admin.module.css';

const LIVE = [{ table: 'no_show_disputes' }];
const back = adminZoneBack(ADMIN_DISPUTES_PATH);

/**
 * Contestații de neprezentare (T53), a page of their own since A1 (it was a section of Moderare):
 * the same decisions, the same list, live.
 */
export function NoShowDisputesScreen() {
  const { t } = useI18n();
  const load = useCallback(() => fetchNoShowDisputes(), []);
  const { state, reload, refetch } = useLiveData(load, LIVE, 'admin-disputes');
  const [notice, setNotice] = useState<Msg | null>(null);

  return (
    <div className={styles.page}>
      <BackLink to={back.to} label={t(back.label)} />
      <h1>{t('admin.disputes.title')}</h1>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {state.status === 'ready' && (
        <>
          {notice && (
            <p className={styles.muted} role="status">
              {t(notice.key, notice.params)}
            </p>
          )}
          <NoShowDisputesSection
            data={state.data}
            onDecided={() => {
              setNotice({ key: 'admin.done.decided' });
              void refetch().catch(() => {});
            }}
          />
        </>
      )}
    </div>
  );
}
