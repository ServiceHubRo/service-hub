import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { Banner } from '../../components/Banner';
import { useCaptcha } from '../../components/useCaptcha';
import { Checkbox } from '../../components/Checkbox';
import { Field } from '../../components/Field';
import { PasswordField } from '../../components/PasswordField';
import { AuthFailure, authErrorMessage, isRetryable, signIn, toAuthFailure } from '../../data/auth';
import { useI18n } from '../../i18n/context';
import { looksLikeEmail } from '../../lib/password';
import { rememberMe } from '../../lib/remember';
import { ResendConfirmation } from './ResendConfirmation';
import { useFocusFirstError } from './useFocusFirstError';
import styles from './auth.module.css';

interface Errors {
  email?: string;
  password?: string;
}

/** Email + password, "Ține-mă minte" ticked by default (per device), "Ai uitat parola?". */
export function SignInForm({ email, setEmail }: { email: string; setEmail: (email: string) => void }) {
  const { t, lang } = useI18n();
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(rememberMe);
  const [errors, setErrors] = useState<Errors>({});
  const [attempt, setAttempt] = useState(0);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const captcha = useCaptcha();
  useFocusFirstError(formRef, errors, attempt);

  async function submit() {
    const next: Errors = {};
    if (!looksLikeEmail(email)) next.email = t('auth.error.emailFormat');
    if (password === '') next.password = t('auth.error.passwordRequired');
    setErrors(next);
    setAttempt((a) => a + 1);
    if (Object.keys(next).length > 0) return;
    if (!captcha.ready) throw new AuthFailure('captcha_failed');

    setUnconfirmedEmail(null);
    try {
      await signIn(email, password, remember, captcha.token);
    } catch (e) {
      if (toAuthFailure(e).code === 'email_not_confirmed') setUnconfirmedEmail(email.trim());
      throw e;
    } finally {
      captcha.reset();
    }
    // Signed in: the session provider loads the profile and the route sends the user home.
  }

  return (
    <form ref={formRef} className={styles.form} noValidate onSubmit={(e) => e.preventDefault()}>
      <Field
        label={t('auth.email')}
        type="email"
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
      />
      <PasswordField
        label={t('auth.password')}
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
      />
      <Link to="/parola-uitata" state={{ email }} className={styles.forgot}>
        {t('auth.forgot')}
      </Link>
      <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)}>
        {t('auth.remember')}
      </Checkbox>
      {captcha.element}
      <ActionButton
        submit
        onAction={submit}
        errorMessage={(e) => authErrorMessage(lang, e)}
        canRetry={isRetryable}
      >
        {t('auth.signIn')}
      </ActionButton>
      {unconfirmedEmail && (
        <Banner tone="warning">
          <div className={styles.stack}>
            <span>{t('auth.unconfirmed', { email: unconfirmedEmail })}</span>
            <ResendConfirmation email={unconfirmedEmail} />
          </div>
        </Banner>
      )}
    </form>
  );
}
