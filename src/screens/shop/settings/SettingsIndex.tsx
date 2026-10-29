import { Building2, CalendarClock, FileText, Images, ListChecks, SlidersHorizontal, Store, Users } from 'lucide-react';
import { PageHeader } from '../../../components/PageHeader';
import { Tile } from '../../../components/Tile';
import { useI18n } from '../../../i18n/context';
import { SETTINGS_LINKS } from './paths';
import { useShopSettings } from './shopSettingsContext';
import styles from './settings.module.css';

/**
 * Setări service: one tile per section (reached from Cont, not from the navigation bar). A
 * colleague gets a line saying who changes them; notifications are in Cont → Notificări.
 */
export function SettingsIndex() {
  const { t } = useI18n();
  const { isOwner } = useShopSettings();
  return (
    <div className={styles.page}>
      <PageHeader
        back={{ to: '/s/cont', label: t('nav.account') }}
        title={t('settings.title')}
        subtitle={isOwner ? undefined : t('settings.staff.body')}
      />
      <div className={styles.tiles} data-layout="tiles">
        {isOwner && (
          <>
            <Tile to={SETTINGS_LINKS.profile} icon={Store} label={t('settings.profile')} hint={t('settings.profile.hint')} />
            <Tile to={SETTINGS_LINKS.showcase} icon={Images} label={t('settings.showcase')} hint={t('settings.showcase.hint')} />
            <Tile to={SETTINGS_LINKS.hours} icon={CalendarClock} label={t('settings.hours')} hint={t('settings.hours.hint')} />
            <Tile to={SETTINGS_LINKS.rules} icon={SlidersHorizontal} label={t('settings.rules')} hint={t('settings.rules.hint')} />
            <Tile to={SETTINGS_LINKS.services} icon={ListChecks} label={t('settings.services')} hint={t('settings.services.hint')} />
            <Tile to={SETTINGS_LINKS.quotes} icon={FileText} label={t('settings.quotes')} hint={t('settings.quotes.hint')} />
            <Tile to={SETTINGS_LINKS.billing} icon={Building2} label={t('settings.billing')} hint={t('settings.billing.hint')} />
            <Tile to={SETTINGS_LINKS.staff} icon={Users} label={t('settings.staff')} hint={t('settings.staff.hint')} />
          </>
        )}
      </div>
    </div>
  );
}
