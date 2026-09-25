import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../../app/sessionContext';
import { Card } from '../../components/Card';
import { Checkbox } from '../../components/Checkbox';
import { updateReminderPrefs } from '../../data/profile';
import { useI18n } from '../../i18n/context';
import { SaveButton } from '../shop/settings/SaveButton';
import styles from './account.module.css';

/**
 * Cont → Remindere (clients, T19d): the review request the day after a job and the service
 * reminders (oil, brake fluid …) about two weeks before they are due. Both push notifications,
 * both on by default; the review card on Caută follows the first one.
 */
export function RemindersCard() {
  const { t } = useI18n();
  const session = useSession();
  const profile = session.profile!;
  const [review, setReview] = useState(profile.review_requests);
  const [service, setService] = useState(profile.service_reminders);
  const changed = review !== profile.review_requests || service !== profile.service_reminders;

  async function save() {
    const saved = await updateReminderPrefs(profile.id, { review_requests: review, service_reminders: service });
    session.setProfile(saved);
    setReview(saved.review_requests);
    setService(saved.service_reminders);
  }

  return (
    <Card role="group" aria-labelledby="reminders-title" className={styles.stack}>
      <span className={styles.rowLabel}>
        <CalendarClock size={20} aria-hidden="true" />
        <span id="reminders-title">{t('reminders.title')}</span>
      </span>
      <div>
        <Checkbox checked={review} onChange={(e) => setReview(e.target.checked)} aria-describedby="reminders-review-hint">
          {t('reminders.review')}
        </Checkbox>
        <p id="reminders-review-hint" className={styles.small}>
          {t('reminders.review.hint')}
        </p>
      </div>
      <div>
        <Checkbox checked={service} onChange={(e) => setService(e.target.checked)} aria-describedby="reminders-service-hint">
          {t('reminders.service')}
        </Checkbox>
        <p id="reminders-service-hint" className={styles.small}>
          {t('reminders.service.hint')}
        </p>
      </div>
      <SaveButton onSave={save} disabled={!changed}>
        {t('reminders.save')}
      </SaveButton>
    </Card>
  );
}
