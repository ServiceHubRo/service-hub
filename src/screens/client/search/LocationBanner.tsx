import { MapPin, X } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../../../app/sessionContext';
import { Button } from '../../../components/Button';
import { dismissLocationPrompt } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { requestLocation, useLocation, type LocationStatus } from '../../../lib/location';
import { sessionStore } from '../../../lib/storage';
import styles from './SearchScreen.module.css';

const HIDDEN_KEY = 'sh_location_banner_hidden';

/**
 * P16d: asks for the location in the app first. The browser's own prompt appears only when the
 * client taps "Activează", never on its own. "Nu acum" hides it for good (saved on the profile);
 * it can be turned on later from Cont.
 */
export function LocationBanner() {
  const { t } = useI18n();
  const session = useSession();
  const location = useLocation();
  const [hidden, setHidden] = useState(() => sessionStore.get(HIDDEN_KEY) === '1');
  const [asked, setAsked] = useState(false);
  const [outcome, setOutcome] = useState<LocationStatus | null>(null);

  if (outcome === 'denied' || outcome === 'error' || outcome === 'unsupported') {
    return (
      <div className={styles.locationBanner} role="alert">
        <MapPin size={18} className={styles.locationIcon} aria-hidden="true" />
        <p className={styles.locationText}>{t(`location.outcome.${outcome}`)}</p>
        <button type="button" className={styles.iconButton} aria-label={t('common.close')} onClick={() => setOutcome(null)}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    );
  }

  const undecided = location.status === 'prompt' || (asked && location.status === 'locating');
  if (hidden || !undecided || session.profile?.location_prompt_dismissed_at) return null;

  async function enable() {
    setAsked(true);
    const result = await requestLocation();
    if (result !== 'granted') setOutcome(result);
  }

  function dismiss() {
    setHidden(true);
    sessionStore.set(HIDDEN_KEY, '1');
    const profile = session.profile;
    if (!profile) return;
    // Best effort: if saving fails the banner stays hidden for this visit and comes back next time.
    dismissLocationPrompt(profile.id).then(
      () => session.setProfile({ ...profile, location_prompt_dismissed_at: new Date().toISOString() }),
      () => undefined,
    );
  }

  const busy = location.status === 'locating';
  return (
    <section className={styles.locationBanner} aria-label={t('location.title')}>
      <MapPin size={18} className={styles.locationIcon} aria-hidden="true" />
      <p className={styles.locationText}>{t('location.banner')}</p>
      <div className={styles.locationActions}>
        <Button variant="primary" onClick={() => void enable()} disabled={busy} aria-busy={busy}>
          {busy ? t('location.locating') : t('location.enable')}
        </Button>
        <Button variant="ghost" onClick={dismiss} disabled={busy}>
          {t('location.notNow')}
        </Button>
      </div>
    </section>
  );
}
