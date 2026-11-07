import type { AdminBookingEvent } from '../../data/admin';
import { useI18n } from '../../i18n/context';
import { systemMessageText } from '../../lib/messages';
import { dateTime } from './format';
import styles from './admin.module.css';

/**
 * A booking's history for the admin (P3): only its automatic events (confirmed, quote sent,
 * cancelled, …), as the client read them. Messages written by the client or the shop are private and
 * never reach the admin.
 */
export function BookingEvents({ events }: { events: AdminBookingEvent[] }) {
  const { t, lang } = useI18n();
  if (events.length === 0) return <p className={styles.muted}>{t('admin.booking.noEvents')}</p>;
  return (
    <ol className={styles.messages}>
      {events.map((e) => (
        <li key={e.id} className={`${styles.msg} ${styles.msgSystem}`}>
          <span className={styles.msgWho}>{dateTime(lang, e.created_at)}</span>
          <span className={styles.msgBody}>{systemMessageText(lang, 'client', e.event, e.params)}</span>
        </li>
      ))}
    </ol>
  );
}
