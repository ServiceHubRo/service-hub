import { PageHeader } from '../../components/PageHeader';
import { Section, SectionCard } from '../../components/Section';
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
    <div className={styles.page} data-layout="sections">
      <PageHeader back={{ to: NAV.client.account.path, label: t('nav.account') }} title={t('settings.notifications')} />
      {/* The same sections as the shop's Notificări (docs/MODEL_DE_FOLOSIRE.md): this device, then
          the reminders as rows of one card. */}
      <Section title={t('notif.sec.device')} description={t('notif.sec.device.desc')}>
        <PushRow />
      </Section>
      <Section title={t('notif.sec.reminders')}>
        <SectionCard>
          <ReminderRow bare setting="review_requests" />
          <ReminderRow bare setting="service_reminders" />
          <ReminderRow bare setting="season_reminders" />
          <ReminderRow bare setting="promo_notifications" />
        </SectionCard>
      </Section>
    </div>
  );
}
