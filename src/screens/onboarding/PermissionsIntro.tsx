import { Bell, MapPin } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useSession } from '../../app/sessionContext';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { dismissPushPrompt, enablePush, usePushStatus } from '../../data/push';
import { rpcErrorMessage } from '../../data/rpc';
import { dismissLocationPrompt } from '../../data/search';
import { useI18n } from '../../i18n/context';
import { requestLocation, useLocation } from '../../lib/location';
import { onboardedKey, onboardingSteps, type OnboardingStep } from '../../lib/onboarding';
import { storage } from '../../lib/storage';
import styles from './onboarding.module.css';

/**
 * The first start of the phone app (Eduard, 11 Oct): one screen per permission, the system's own
 * prompt only after "Permite". "Nu acum" puts it off like the banners do (saved on the profile),
 * so Caută and Panou do not ask again at once. Once per account on a device.
 */
export function PermissionsIntro({ role }: { role: 'client' | 'shop' | 'admin' }) {
  const { t, lang } = useI18n();
  const session = useSession();
  const profile = session.profile;
  const location = useLocation();
  const push = usePushStatus();
  const titleId = useId();
  const [done, setDone] = useState(() => (profile ? storage.get(onboardedKey(profile.id)) === '1' : true));
  // The steps are fixed when first known: answering one must not reshuffle the rest.
  const [steps, setSteps] = useState<OnboardingStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const found =
    done || steps || !profile
      ? null
      : onboardingSteps({
          role,
          location: location.status,
          push,
          locationPutOff: Boolean(profile.location_prompt_dismissed_at),
          pushPutOff: Boolean(profile.push_prompt_dismissed_at),
        });
  if (found) {
    if (found.length === 0) setDone(true);
    else setSteps(found);
  }

  const step = steps && !done ? steps[index] : undefined;

  useEffect(() => {
    if (step) cardRef.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [step]);

  if (!step || !steps || !profile) return null;

  function next() {
    if (index + 1 < (steps?.length ?? 0)) {
      setIndex(index + 1);
      return;
    }
    if (profile) storage.set(onboardedKey(profile.id), '1');
    setDone(true);
  }

  async function allow() {
    if (step === 'location') await requestLocation();
    else await enablePush();
    next();
  }

  function notNow() {
    if (!profile) return;
    const at = new Date().toISOString();
    // Best effort, like the banners: if saving fails, the banner asks again later.
    if (step === 'location') {
      dismissLocationPrompt(profile.id).then(
        () => session.setProfile({ ...profile, location_prompt_dismissed_at: at }),
        () => undefined,
      );
    } else {
      dismissPushPrompt(profile.id).then(
        () => session.setProfile({ ...profile, push_prompt_dismissed_at: at }),
        () => undefined,
      );
    }
    next();
  }

  const Icon = step === 'location' ? MapPin : Bell;
  const body = step === 'location' ? t('onboard.location.body') : role === 'shop' ? t('onboard.push.shop') : t('onboard.push.client');
  return (
    <div className={styles.overlay}>
      <div ref={cardRef} className={styles.card} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {steps.length > 1 && (
          <p className={styles.step}>{t('onboard.step', { n: index + 1, total: steps.length })}</p>
        )}
        <span className={styles.icon} aria-hidden="true">
          <Icon size={34} />
        </span>
        <h2 id={titleId} className={styles.title}>
          {step === 'location' ? t('onboard.location.title') : t('onboard.push.title')}
        </h2>
        <p className={styles.body}>{body}</p>
        <div className={styles.actions}>
          <ActionButton key={step} onAction={allow} errorMessage={(e) => rpcErrorMessage(lang, e)}>
            {t('onboard.allow')}
          </ActionButton>
          <Button variant="ghost" onClick={notNow}>
            {t('onboard.notNow')}
          </Button>
        </div>
      </div>
    </div>
  );
}
