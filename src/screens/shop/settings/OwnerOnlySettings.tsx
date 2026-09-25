import { Lock } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { BackLink } from '../../../components/BackLink';
import { EmptyState } from '../../../components/EmptyState';
import { useI18n } from '../../../i18n/context';
import { SETTINGS_PATH } from './paths';
import { useShopSettings } from './shopSettingsContext';
import styles from './settings.module.css';

/**
 * The settings sections a colleague may not change (public profile, hours, rules and fee,
 * services): the owner's alone. The database refuses a colleague's write anyway.
 */
export function OwnerOnlySettings() {
  const { t } = useI18n();
  const context = useShopSettings();
  if (context.isOwner) return <Outlet context={context} />;
  return (
    <div className={styles.page}>
      <BackLink to={SETTINGS_PATH} label={t('settings.title')} />
      <EmptyState icon={Lock} title={t('settings.ownerOnly')} body={t('settings.staff.body')} />
    </div>
  );
}
