import { useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { useCaptcha } from '../../components/useCaptcha';
import { authErrorMessage, isRetryable, resendConfirmation } from '../../data/auth';
import { useI18n } from '../../i18n/context';
import { recordEmailSent, useCountdown } from '../../lib/cooldown';
import styles from './auth.module.css';

const GAP_SECONDS = 60;

/** "Retrimite emailul" — at most once every 60 s per address (FR §2). */
export function ResendConfirmation({ email }: { email: string }) {
  const { t, lang } = useI18n();
  const [left, refresh] = useCountdown('signup', email, GAP_SECONDS);
  const [sent, setSent] = useState(false);
  const captcha = useCaptcha();

  async function resend() {
    setSent(false);
    try {
      await resendConfirmation(email, captcha.token);
    } finally {
      captcha.reset();
    }
    recordEmailSent('signup', email);
    refresh();
    setSent(true);
  }

  return (
    <div className={styles.stack}>
      {captcha.element}
      <ActionButton
        variant="secondary"
        onAction={resend}
        disabled={left > 0 || !captcha.ready}
        errorMessage={(e) => authErrorMessage(lang, e)}
        canRetry={isRetryable}
      >
        {left > 0 ? t('auth.resendIn', { seconds: left }) : t('auth.resend')}
      </ActionButton>
      {sent && (
        <p className={styles.note} role="status">
          {t('auth.resent', { email })}
        </p>
      )}
    </div>
  );
}
