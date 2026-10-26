import { BackLink } from '../../components/BackLink';
import { NAV } from '../../app/roles';
import { useI18n } from '../../i18n/context';
import { PushRow } from '../push/PushRow';
import { ReminderRow } from './ReminderRow';
import styles from './account.module.css';

/**
 * Cont → Notificări for a client (Eduard, 26 Oct: every notification setting in one place): push on
 * this device and the reminders the account gets (review requests, service, tires, offers).
 */
export function ClientNotificationsScreen() {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <BackLink to={NAV.client.account.path} label={t('nav.account')} />
      <h1>{t('settings.notifications')}</h1>
      <PushRow />
      <ReminderRow setting="review_requests" />
      <ReminderRow setting="service_reminders" />
      <ReminderRow setting="season_reminders" />
      <ReminderRow setting="promo_notifications" />
    </div>
  );
}
