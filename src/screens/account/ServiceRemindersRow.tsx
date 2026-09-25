import { CalendarClock } from 'lucide-react';
import { useSession } from '../../app/sessionContext';
import { ActionButton } from '../../components/ActionButton';
import { Card } from '../../components/Card';
import { setServiceReminders } from '../../data/profile';
import { rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import styles from './account.module.css';

/**
 * Cont → Remindere de revizie (T19d): a push about two weeks before a service with an interval
 * (oil, filters, brake fluid…) comes due again, from the last time it was done through the app.
 * On by default; the client turns them off here.
 */
export function ServiceRemindersRow() {
  const { t, lang } = useI18n();
  const session = useSession();
  const profile = session.profile;
  if (!profile) return null;
  const on = profile.service_reminders;

  return (
    <Card role="group" aria-label={t('serviceReminders.title')}>
      <div className={styles.row}>
        <span className={styles.rowLabel}>
          <CalendarClock size={20} aria-hidden="true" />
          <span className={styles.who}>
            <span>{t('serviceReminders.title')}</span>
            <span className={styles.small}>{t(on ? 'serviceReminders.on' : 'serviceReminders.off')}</span>
          </span>
        </span>
        <ActionButton
          variant="secondary"
          block={false}
          onAction={async () => {
            session.setProfile(await setServiceReminders(profile.id, !on));
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
        >
          {t(on ? 'serviceReminders.turnOff' : 'serviceReminders.turnOn')}
        </ActionButton>
      </div>
    </Card>
  );
}
