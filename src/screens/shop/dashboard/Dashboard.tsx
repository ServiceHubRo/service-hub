import { Car, ChevronRight, Unlink } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { Banner } from '../../../components/Banner';
import { EmptyState } from '../../../components/EmptyState';
import { SkeletonList } from '../../../components/Skeleton';
import { RpcError, rpcErrorMessage } from '../../../data/rpc';
import { dismissBillingReminder, getShopSetup, type ShopSetup } from '../../../data/shop';
import { useI18n } from '../../../i18n/context';
import type { MessageKey } from '../../../i18n/ro';
import { ymdInBucharest } from '../../../i18n/format';
import { dashboardCounts } from '../../../lib/shopBookings';
import { useLoad } from '../../../lib/useLoad';
import { useNow } from '../../../lib/useNow';
import { LoadError } from '../../../components/LoadError';
import { PushBanner } from '../../push/PushBanner';
import { useShopBookings } from '../bookings/shopBookingsContext';
import { SETTINGS_LINKS } from '../settings/paths';
import { SetupChecklist } from './SetupChecklist';
import { TodayBoard } from './TodayBoard';
import styles from './Dashboard.module.css';

/**
 * Panou (FR §4.1): why the shop is not in search (§5), the billing reminder (FR §4.5b), the
 * first-run checklist (P5d), then the six counters, the capacity line and today's schedule (T08),
 * live from ShopBookingsProvider.
 */
export function Dashboard() {
  const { t, lang } = useI18n();
  const load = useCallback(() => getShopSetup(), []);
  const { state, reload, setData } = useLoad(load);
  const bookings = useShopBookings();
  const today = ymdInBucharest(useNow());
  const { refresh } = bookings;

  // Arriving here reads the bookings again quietly (the counters are already on screen).
  useEffect(() => {
    refresh();
  }, [refresh]);

  let body;
  if (state.status === 'loading' || bookings.state.status === 'loading') body = <SkeletonList />;
  else if (state.status === 'error' || bookings.state.status === 'error') {
    const error = state.status === 'error' ? state.error : bookings.state.status === 'error' ? bookings.state.error : null;
    body =
      error instanceof RpcError && error.code === 'not_allowed' ? (
        <EmptyState icon={Unlink} title={t('settings.noShop')} />
      ) : (
        <LoadError
          message={t('dash.loadError')}
          onRetry={() => {
            if (state.status === 'error') reload();
            if (bookings.state.status === 'error') bookings.reload();
          }}
        />
      );
  } else {
    const setup = state.data;
    const data = bookings.state.data;
    const counts = dashboardCounts(data.bookings, today);
    body = (
      <>
        {setup.reasons.length > 0 && (
          <div className="no-print">
            <HiddenBanner setup={setup} />
          </div>
        )}
        {setup.billing?.reminder && (
          <div className="no-print">
            <Banner tone="info">
              <div className={styles.reminder}>
                <span>{t('dash.billing.reminder')}</span>
                <div className={styles.reminderButtons}>
                  <Link to={SETTINGS_LINKS.billing} className={styles.reminderLink}>
                    {t('dash.billing.open')}
                  </Link>
                  <ActionButton
                    variant="ghost"
                    block={false}
                    errorMessage={(e) => rpcErrorMessage(lang, e)}
                    onAction={async () => {
                      await dismissBillingReminder(setup.shop_id);
                      setData((s) => ({ ...s, billing: s.billing && { ...s.billing, reminder: false } }));
                    }}
                  >
                    {t('dash.billing.dismiss')}
                  </ActionButton>
                </div>
              </div>
            </Banner>
          </div>
        )}
        {!setup.setup_completed && (
          <div className="no-print">
            <SetupChecklist setup={setup} />
          </div>
        )}
        <TodayBoard data={data} today={today} />
        <Link to={SETTINGS_LINKS.capacity} className={`${styles.capacity} no-print`}>
          <Car size={20} className={styles.capacityIcon} aria-hidden="true" />
          <span className={styles.capacityText}>
            {t('dash.capacity', { n: data.shop.daily_capacity, today: counts.todayTaken })}
          </span>
          <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
        </Link>
      </>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className="no-print">{t('nav.shop.dashboard')}</h1>
      <div className="no-print">
        <PushBanner role="shop" />
      </div>
      {body}
    </div>
  );
}

/** "Service-ul tău nu apare încă în căutări." with every reason, in the order to fix them. */
function HiddenBanner({ setup }: { setup: ShopSetup }) {
  const { t } = useI18n();
  const link: Partial<Record<ShopSetup['reasons'][number], string>> = {
    no_services: SETTINGS_LINKS.services,
    no_open_days: SETTINGS_LINKS.hours,
  };
  return (
    <Banner tone="warning">
      <p className={styles.hiddenTitle}>{t('dash.hidden.title')}</p>
      <ul className={styles.reasons}>
        {setup.reasons.map((r) => {
          const text = t(`dash.hidden.${r}` as MessageKey);
          const to = link[r];
          return <li key={r}>{to ? <Link to={to}>{text}</Link> : text}</li>;
        })}
      </ul>
    </Banner>
  );
}
