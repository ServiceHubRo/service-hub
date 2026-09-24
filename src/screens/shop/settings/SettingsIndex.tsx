import { Bell, Building2, CalendarClock, ListChecks, SlidersHorizontal, Store, Users } from 'lucide-react';
import { BackLink } from '../../../components/BackLink';
import { Tile } from '../../../components/Tile';
import { useI18n } from '../../../i18n/context';
import { SETTINGS_LINKS } from './paths';
import { useShopSettings } from './shopSettingsContext';
import styles from './settings.module.css';

/** Setări service: one tile per section (reached from Cont, not from the navigation bar). */
export function SettingsIndex() {
  const { t } = useI18n();
  const { isOwner } = useShopSettings();
  return (
    <div className={styles.page}>
      <BackLink to="/s/cont" label={t('nav.account')} />
      <h1>{t('settings.title')}</h1>
      <div className={styles.tiles}>
        <Tile to={SETTINGS_LINKS.profile} icon={Store} label={t('settings.profile')} hint={t('settings.profile.hint')} />
        <Tile to={SETTINGS_LINKS.hours} icon={CalendarClock} label={t('settings.hours')} hint={t('settings.hours.hint')} />
        <Tile to={SETTINGS_LINKS.rules} icon={SlidersHorizontal} label={t('settings.rules')} hint={t('settings.rules.hint')} />
        <Tile to={SETTINGS_LINKS.services} icon={ListChecks} label={t('settings.services')} hint={t('settings.services.hint')} />
        {isOwner && (
          <Tile to={SETTINGS_LINKS.billing} icon={Building2} label={t('settings.billing')} hint={t('settings.billing.hint')} />
        )}
        {isOwner && <Tile to={SETTINGS_LINKS.staff} icon={Users} label={t('settings.staff')} hint={t('settings.staff.hint')} />}
        <Tile to={SETTINGS_LINKS.notifications} icon={Bell} label={t('settings.notifications')} hint={t('settings.notifications.hint')} />
      </div>
    </div>
  );
}
