import { BadgePercent, CalendarClock, CircleDot, Lightbulb, Star } from 'lucide-react';
import { useSession } from '../../app/sessionContext';
import { ActionButton } from '../../components/ActionButton';
import { Card } from '../../components/Card';
import { setReminder, type ReminderSetting } from '../../data/profile';
import { rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import styles from './account.module.css';

const ROWS = {
  // The push the day after a job (and the card on Caută).
  review_requests: {
    icon: Star,
    title: 'reviewRequests.title',
    on: 'reviewRequests.on',
    off: 'reviewRequests.off',
  },
  // A push about two weeks before a service with an interval (oil, filters, brake fluid…) comes
  // due again, from the last time it was done through the app.
  service_reminders: {
    icon: CalendarClock,
    title: 'serviceReminders.title',
    on: 'serviceReminders.on',
    off: 'serviceReminders.off',
  },
  // T24: winter and summer tires, once a season.
  season_reminders: {
    icon: CircleDot,
    title: 'seasonReminders.title',
    on: 'seasonReminders.on',
    off: 'seasonReminders.off',
  },
  // T24: two tips in the first two weeks, while the client has not booked yet. No row in Cont since
  // 4 Oct (Eduard): on for everyone; the phone's notification settings still stop them.
  app_tips: {
    icon: Lightbulb,
    title: 'appTips.title',
    on: 'appTips.on',
    off: 'appTips.off',
  },
  // T24: the offers of favorite shops — marketing, so off until the client turns them on.
  promo_notifications: {
    icon: BadgePercent,
    title: 'promoNotifications.title',
    on: 'promoNotifications.on',
    off: 'promoNotifications.off',
  },
} as const;

/** Cont → one of the client's reminders (T19d, T24): on by default (offers: off), switched here. */
export function ReminderRow({ setting }: { setting: ReminderSetting }) {
  const { t, lang } = useI18n();
  const session = useSession();
  const profile = session.profile;
  if (!profile) return null;
  const row = ROWS[setting];
  const Icon = row.icon;
  const on = profile[setting];

  return (
    <Card role="group" aria-label={t(row.title)}>
      <div className={styles.row}>
        <span className={styles.rowLabel}>
          <Icon size={20} aria-hidden="true" />
          <span className={styles.who}>
            <span>{t(row.title)}</span>
            <span className={styles.small}>{t(on ? row.on : row.off)}</span>
          </span>
        </span>
        <ActionButton
          variant="secondary"
          block={false}
          onAction={async () => {
            session.setProfile(await setReminder(profile.id, setting, !on));
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
        >
          {t(on ? 'reminders.turnOff' : 'reminders.turnOn')}
        </ActionButton>
      </div>
    </Card>
  );
}
