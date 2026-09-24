import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActionButton } from '../components/ActionButton';
import { Button } from '../components/Button';
import { useCaptcha } from '../components/useCaptcha';
import { Field } from '../components/Field';
import { PasswordField } from '../components/PasswordField';
import { AuthFailure, authErrorMessage, isRetryable, signIn } from '../data/auth';
import { useI18n } from '../i18n/context';
import { rememberMe } from '../lib/remember';
import styles from './ReauthPanel.module.css';
import { useSession } from './sessionContext';

/**
 * The session ended while the app was open (FR §10): a sign-in panel covers the screen, which stays
 * mounted underneath with everything the user typed. Signing in again removes the panel.
 */
export function ReauthPanel() {
  const { t, lang } = useI18n();
  const session = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState(session.user?.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const captcha = useCaptcha();
  const passwordRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    passwordRef.current?.querySelector('input')?.focus();
  }, []);

  async function submit() {
    setError(password === '' ? t('auth.error.passwordRequired') : null);
    if (password === '') return;
    if (!captcha.ready) throw new AuthFailure('captcha_failed');
    try {
      await signIn(email, password, rememberMe(), captcha.token);
    } finally {
      captcha.reset();
    }
  }

  async function leave() {
    navigate('/', { replace: true, state: { leaving: true } });
    await session.signOut();
  }

  return (
    <div className={styles.backdrop}>
      <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="reauth-title">
        <h2 id="reauth-title" className={styles.title}>
          {t('session.expired.title')}
        </h2>
        <p className={styles.body}>{t('session.expired.body')}</p>
        <form className={styles.form} noValidate onSubmit={(e) => e.preventDefault()}>
          <Field
            label={t('auth.email')}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div ref={passwordRef}>
            <PasswordField
              label={t('auth.password')}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error}
            />
          </div>
          {captcha.element}
          <ActionButton submit onAction={submit} errorMessage={(e) => authErrorMessage(lang, e)} canRetry={isRetryable}>
            {t('auth.signIn')}
          </ActionButton>
          <Button variant="ghost" block onClick={() => void leave()}>
            {t('nav.logout')}
          </Button>
        </form>
      </div>
    </div>
  );
}
