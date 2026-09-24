import { Car, ChevronRight, Unlink } from 'lucide-react';
import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { Banner } from '../../../components/Banner';
import { EmptyState } from '../../../components/EmptyState';
import { SkeletonList } from '../../../components/Skeleton';
import { RpcError, rpcErrorMessage } from '../../../data/rpc';
import { dismissBillingReminder, getShopSetup, type ShopSetup } from '../../../data/shop';
import { useI18n } from '../../../i18n/context';
import type { MessageKey } from '../../../i18n/ro';
import { useLoad } from '../../../lib/useLoad';
import { LoadError } from '../../../components/LoadError';
import { SETTINGS_LINKS } from '../settings/paths';
import { SetupChecklist } from './SetupChecklist';
import styles from './Dashboard.module.css';

/**
 * Panou. T05: the first-run checklist (P5d), why the shop is not in search (§5), the billing
 * reminder (FR §4.5b) and the capacity line. Counters and today's schedule arrive in T08.
 */
export function Dashboard() {
  const { t, lang } = useI18n();
  const load = useCallback(() => getShopSetup(), []);
  const { state, reload, setData } = useLoad(load);

  let body;
  if (state.status === 'loading') body = <SkeletonList />;
  else if (state.status === 'error') {
    body =
      state.error instanceof RpcError && state.error.code === 'not_allowed' ? (
        <EmptyState icon={Unlink} title={t('settings.noShop')} />
      ) : (
        <LoadError message={t('dash.loadError')} onRetry={reload} />
      );
  } else {
    const setup = state.data;
    body = (
      <>
        {setup.reasons.length > 0 && <HiddenBanner setup={setup} />}
        {setup.billing?.reminder && (
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
        )}
        {!setup.setup_completed && <SetupChecklist setup={setup} />}
        <Link to={SETTINGS_LINKS.capacity} className={styles.capacity}>
          <Car size={20} className={styles.capacityIcon} aria-hidden="true" />
          <span className={styles.capacityText}>{t('dash.capacity', { n: setup.daily_capacity })}</span>
          <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
        </Link>
      </>
    );
  }

  return (
    <div className={styles.page}>
      <h1>{t('nav.shop.dashboard')}</h1>
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
