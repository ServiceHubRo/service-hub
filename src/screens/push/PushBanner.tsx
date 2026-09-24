import { Bell, BellOff, Check, X } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../../app/sessionContext';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { dismissPushPrompt, enablePush, usePushStatus, type EnableOutcome } from '../../data/push';
import { rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { sessionStore } from '../../lib/storage';
import { useNow } from '../../lib/useNow';
import styles from './push.module.css';

const HIDDEN_KEY = 'sh_push_banner_hidden';
/** After "Nu acum" the banner stays away for the session and comes back a week later. */
const SNOOZE_MS = 7 * 24 * 3600 * 1000;

/**
 * P15b, the soft ask: an explanation first, the browser's own prompt only after "Activează" — never
 * on load. Shown near the top of Caută (clients) and Panou (shops) while the browser has not been
 * asked; on an iPhone in a Safari tab it explains the Home Screen step instead of offering a button
 * that cannot work.
 */
export function PushBanner({ role }: { role: 'client' | 'shop' }) {
  const { t, lang } = useI18n();
  const session = useSession();
  const status = usePushStatus();
  const now = useNow();
  const [hidden, setHidden] = useState(() => sessionStore.get(HIDDEN_KEY) === '1');
  const [outcome, setOutcome] = useState<EnableOutcome | null>(null);

  if (outcome === 'on' || outcome === 'denied') {
    return (
      <div className={styles.banner} role="status">
        {outcome === 'on' ? (
          <Check size={18} className={styles.icon} aria-hidden="true" />
        ) : (
          <BellOff size={18} className={styles.icon} aria-hidden="true" />
        )}
        <p className={styles.text}>{t(`push.outcome.${outcome}`)}</p>
        <button type="button" className={styles.close} aria-label={t('common.close')} onClick={() => setOutcome(null)}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    );
  }

  const dismissedAt = session.profile?.push_prompt_dismissed_at;
  const snoozed = dismissedAt ? now.getTime() - new Date(dismissedAt).getTime() < SNOOZE_MS : false;
  const askable = status === 'prompt' || status === 'ios_install' || status === 'working';
  if (hidden || snoozed || !askable) return null;

  function hide() {
    setHidden(true);
    sessionStore.set(HIDDEN_KEY, '1');
  }

  function notNow() {
    hide();
    const profile = session.profile;
    if (!profile) return;
    // Best effort: if saving fails the banner stays hidden for this session only.
    dismissPushPrompt(profile.id).then(
      () => session.setProfile({ ...profile, push_prompt_dismissed_at: new Date().toISOString() }),
      () => undefined,
    );
  }

  async function enable() {
    const result = await enablePush();
    // Refused or closed without an answer: no second ask in this session.
    if (result !== 'on') hide();
    if (result !== 'dismissed') setOutcome(result);
  }

  const ios = status === 'ios_install';
  return (
    <section className={styles.banner} aria-label={t('push.title')}>
      <Bell size={18} className={styles.icon} aria-hidden="true" />
      <p className={styles.text}>{t(ios ? 'push.banner.ios' : role === 'shop' ? 'push.banner.shop' : 'push.banner.client')}</p>
      <div className={styles.actions}>
        {!ios && (
          <ActionButton block={false} onAction={enable} errorMessage={(e) => rpcErrorMessage(lang, e)}>
            {t('push.enable')}
          </ActionButton>
        )}
        <Button variant="ghost" onClick={notNow} disabled={status === 'working'}>
          {t('push.notNow')}
        </Button>
      </div>
    </section>
  );
}
