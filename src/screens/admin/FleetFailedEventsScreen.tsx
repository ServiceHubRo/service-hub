import { BellOff } from 'lucide-react';
import { ActionButton } from '../../components/ActionButton';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SkeletonList } from '../../components/Skeleton';
import { adminFailedFleetEvents, adminRetryFleetEvent } from '../../data/fleet';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { formatDate, formatTime } from '../../i18n/format';
import { useLoad } from '../../lib/useLoad';
import { ADMIN_ACCOUNT_PATH } from './paths';
import styles from './admin.module.css';
import own from './fleets.module.css';

/**
 * „Notificări flotă eșuate” (M6, platform admin): the fleet events the outbox gave up on after 24
 * attempts, with a retry. Only the event, the company, the dates, the attempts and the error code: no
 * data of the fleet (no vehicle, person, amount or error text).
 */
export function FleetFailedEventsScreen() {
  const { t, lang } = useI18n();
  const { state, reload } = useLoad(adminFailedFleetEvents);
  const when = (iso: string) => `${formatDate(lang, new Date(iso))} ${formatTime(lang, new Date(iso))}`;

  let body;
  if (state.status === 'loading') body = <SkeletonList />;
  else if (state.status === 'error') body = <LoadError message={t('admin.fleetFailed.loadError')} onRetry={reload} />;
  else if (state.data.length === 0) body = <EmptyState icon={BellOff} title={t('admin.fleetFailed.empty')} />;
  else
    body = (
      <ul className={own.list}>
        {state.data.map((e) => (
          <li key={e.id}>
            <Card className={own.row}>
              <div className={own.rowHead}>
                <div className={own.rowText}>
                  <span className={own.rowName}>{t(`admin.fleetFailed.event.${e.event}` as 'admin.fleetFailed.event.fleet_quote_waiting')}</span>
                  <span className={styles.muted}>{e.company_name}</span>
                  <span className={styles.muted}>
                    {t('admin.fleetFailed.meta', { created: when(e.created_at), failed: when(e.failed_at), n: e.attempts })}
                  </span>
                  <span className={`mono ${styles.muted}`}>
                    #{e.id} · {e.last_error_code ?? '—'}
                  </span>
                </div>
              </div>
              <ActionButton
                variant="secondary"
                block={false}
                onAction={async (rid) => {
                  await adminRetryFleetEvent(e.id, rid);
                  reload();
                }}
                errorMessage={(err) => rpcErrorMessage(lang, err)}
                canRetry={canRetryRpc}
              >
                {t('admin.fleetFailed.retry')}
              </ActionButton>
            </Card>
          </li>
        ))}
      </ul>
    );

  return (
    <div className={styles.page}>
      <PageHeader back={{ to: ADMIN_ACCOUNT_PATH, label: t('nav.account') }} title={t('admin.fleetFailed.title')} />
      {body}
    </div>
  );
}
