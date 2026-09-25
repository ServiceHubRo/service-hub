import { Star } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../../app/sessionContext';
import { Button } from '../../../components/Button';
import { buttonClass } from '../../../components/buttonClass';
import { useI18n } from '../../../i18n/context';
import { reviewToAsk } from '../../../lib/clientBookings';
import { sessionStore } from '../../../lib/storage';
import { useClientBookings } from '../bookings/clientBookingsContext';
import styles from './SearchScreen.module.css';

const HIDDEN_KEY = 'sh_review_prompt_hidden';

/**
 * Top of Caută (T19d): "Cum a fost la Atelier X?" for the newest finished job that can still be
 * reviewed (60 days), until it is reviewed; "Lasă recenzia" opens the booking with the form open.
 * "Nu acum" hides it for this visit (it returns next time, while the review can still be left).
 * Nothing while the bookings load — the search matters more — or when the client turned review
 * requests off in Cont.
 */
export function ReviewPrompt() {
  const { t, lang } = useI18n();
  const { state } = useClientBookings();
  const session = useSession();
  const [hidden, setHidden] = useState(() => sessionStore.get(HIDDEN_KEY));
  // Turned off in Cont → Cerere de recenzie: no card either.
  if (state.status !== 'ready' || session.profile?.review_requests === false) return null;
  const ask = reviewToAsk(state.data.bookings, state.data.reviewWindowDays);
  if (!ask || hidden === ask.booking.id) return null;

  const b = ask.booking;
  const service = b.service ? (lang === 'ro' ? b.service.name_ro : b.service.name_en) : '';
  const shop = b.shop?.name ?? '';
  return (
    <section className={styles.locationBanner} aria-label={t('reviewPrompt.title')}>
      <Star size={18} className={styles.locationIcon} aria-hidden="true" />
      <p className={styles.locationText}>
        {t('reviewPrompt.text', { shop })}
        {service && <span className={styles.reviewPromptService}> {service}</span>}
      </p>
      <div className={styles.locationActions}>
        <Link to={`/c/programari?${new URLSearchParams({ p: b.id, recenzie: '1' })}`} className={buttonClass('primary')}>
          {t('reviewPrompt.leave')}
        </Link>
        <Button
          variant="ghost"
          onClick={() => {
            setHidden(b.id);
            sessionStore.set(HIDDEN_KEY, b.id);
          }}
        >
          {t('reviewPrompt.notNow')}
        </Button>
      </div>
    </section>
  );
}
