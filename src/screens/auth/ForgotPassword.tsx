import { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { Banner } from '../../components/Banner';
import { Card } from '../../components/Card';
import { useCaptcha } from '../../components/useCaptcha';
import { Field } from '../../components/Field';
import { AuthFailure, authErrorMessage, isRetryable, requestPasswordReset } from '../../data/auth';
import { useI18n } from '../../i18n/context';
import { emailsSentLastHour, recordEmailSent } from '../../lib/cooldown';
import { looksLikeEmail } from '../../lib/password';
import { AuthLayout } from './AuthLayout';
import { useFocusFirstError } from './useFocusFirstError';
import styles from './auth.module.css';

const MAX_PER_HOUR = 3;

/** "Ai uitat parola?" (P4c): one neutral answer whether the address exists or not. */
export function ForgotPassword() {
  const { t, lang } = useI18n();
  const location = useLocation();
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [tooMany, setTooMany] = useState(false);
  const captcha = useCaptcha();
  useFocusFirstError(formRef, error ? { email: error } : {}, attempt);

  async function send() {
    const invalid = looksLikeEmail(email) ? null : t('auth.error.emailFormat');
    setError(invalid);
    setAttempt((a) => a + 1);
    if (invalid) return;
    if (emailsSentLastHour('reset', email) >= MAX_PER_HOUR) {
      setTooMany(true);
      return;
    }
    if (!captcha.ready) throw new AuthFailure('captcha_failed');
    setTooMany(false);
    try {
      await requestPasswordReset(email, captcha.token);
    } finally {
      captcha.reset();
    }
    recordEmailSent('reset', email);
    setSentTo(email.trim());
  }

  return (
    <AuthLayout>
      <Card>
        <form ref={formRef} className={styles.form} noValidate onSubmit={(e) => e.preventDefault()}>
          <h1 className={styles.title}>{t('auth.forgot.title')}</h1>
          <p className={styles.note}>{t('auth.forgot.body')}</p>
          <Field
            label={t('auth.email')}
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSentTo(null);
              setTooMany(false);
            }}
            error={error}
          />
          {captcha.element}
          <ActionButton submit onAction={send} errorMessage={(e) => authErrorMessage(lang, e)} canRetry={isRetryable}>
            {t('auth.forgot.send')}
          </ActionButton>
          {tooMany && <Banner tone="error">{t('auth.forgot.tooMany')}</Banner>}
          {sentTo && <Banner>{t('auth.forgot.sent')}</Banner>}
        </form>
      </Card>
      <div className={styles.links}>
        <Link to="/intra" state={{ email }}>
          {t('auth.backToSignIn')}
        </Link>
      </div>
    </AuthLayout>
  );
}
