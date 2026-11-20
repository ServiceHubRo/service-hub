import { BellOff } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { DetailPane, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { adminFailedFleetEvents, adminRetryFleetEvent } from '../../data/fleet';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { adminZoneBack } from '../../app/adminZones';
import { useI18n } from '../../i18n/context';
import { formatDate, formatTime } from '../../i18n/format';
import { useListDetail } from '../../lib/useListDetail';
import { useLoad } from '../../lib/useLoad';
import { ADMIN_FLEET_FAILED_PATH } from './paths';
import styles from './admin.module.css';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_FLEET_FAILED_PATH);

/**
 * „Notificări flotă eșuate” (M6, platform admin): the fleet events the outbox gave up on after 24
 * attempts, with a retry. Only the event, the company, the dates, the attempts and the error code: no
 * data of the fleet (no vehicle, person, amount or error text).
 */
export function FleetFailedEventsScreen() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const { state, reload } = useLoad(adminFailedFleetEvents);
  const when = (iso: string) => `${formatDate(lang, new Date(iso))} ${formatTime(lang, new Date(iso))}`;
  const eventName = (event: string) => t(`admin.fleetFailed.event.${event}` as 'admin.fleetFailed.event.fleet_quote_waiting');

  // Page template A (docs/MODEL_DE_FOLOSIRE.md P8): one row per failed event, the chosen one beside the
  // list from 1024 px (in its place below).
  const events = state.status === 'ready' ? state.data : [];
  const { wide, selectedId, open, select } = useListDetail(
    events.map((e) => String(e.id)),
    'eveniment',
  );
  const chosen = events.find((e) => String(e.id) === selectedId) ?? null;

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('admin.fleetFailed.loadError')} onRetry={reload} />;
  else if (events.length === 0) list = <EmptyState icon={BellOff} title={t('admin.fleetFailed.empty')} />;
  else
    list = (
      <ListRows label={t('admin.fleetFailed.title')}>
        {events.map((e) => (
          <ListRow
            key={e.id}
            icon={<BellOff size={20} />}
            title={eventName(e.event)}
            detail={[e.company_name, when(e.failed_at)].filter(Boolean).join(' · ')}
            selected={wide && String(e.id) === selectedId}
            onSelect={() => select(String(e.id))}
          />
        ))}
      </ListRows>
    );

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={pathname}
        backLabel={t('admin.fleetFailed.title')}
        header={<PageHeader back={{ to: ZONE_BACK.to, label: t(ZONE_BACK.label) }} title={t('admin.fleetFailed.title')} />}
        list={list}
        detail={
          chosen && (
            <DetailPane
              key={chosen.id}
              id={String(chosen.id)}
              icon={<BellOff size={20} />}
              title={eventName(chosen.event)}
              detail={chosen.company_name}
              actions={
                <ActionButton
                  variant="secondary"
                  block={false}
                  onAction={async (rid) => {
                    await adminRetryFleetEvent(chosen.id, rid);
                    reload();
                  }}
                  errorMessage={(err) => rpcErrorMessage(lang, err)}
                  canRetry={canRetryRpc}
                >
                  {t('admin.fleetFailed.retry')}
                </ActionButton>
              }
            >
              <p className={styles.muted}>{t('admin.fleetFailed.meta', { created: when(chosen.created_at), failed: when(chosen.failed_at), n: chosen.attempts })}</p>
              <p className={`mono ${styles.muted}`}>
                #{chosen.id} · {chosen.last_error_code ?? '—'}
              </p>
            </DetailPane>
          )
        }
      />
    </div>
  );
}
