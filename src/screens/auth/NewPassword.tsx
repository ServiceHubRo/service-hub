import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../../app/sessionContext';
import { homeOf } from '../../app/roles';
import { ActionButton } from '../../components/ActionButton';
import { Card } from '../../components/Card';
import { PasswordField } from '../../components/PasswordField';
import { SkeletonList } from '../../components/Skeleton';
import { authErrorMessage, isRetryable, setNewPassword } from '../../data/auth';
import { useI18n } from '../../i18n/context';
import { MIN_PASSWORD_LENGTH } from '../../lib/password';
import { AuthLayout } from './AuthLayout';
import { useFocusFirstError } from './useFocusFirstError';
import styles from './auth.module.css';

interface Errors {
  password?: string;
  confirm?: string;
}

/** Opened from the reset link, which signs the user in (P4c). */
export function NewPassword() {
  const { t, lang } = useI18n();
  const session = useSession();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [attempt, setAttempt] = useState(0);
  useFocusFirstError(formRef, errors, attempt);

  async function save() {
    const next: Errors = {};
    if (password.length < MIN_PASSWORD_LENGTH) next.password = t('auth.error.passwordShort', { min: MIN_PASSWORD_LENGTH });
    else if (confirm !== password) next.confirm = t('auth.error.passwordMismatch');
    setErrors(next);
    setAttempt((a) => a + 1);
    if (Object.keys(next).length > 0) return;
    await setNewPassword(password);
    navigate(session.role ? homeOf(session.role) : '/', { replace: true, state: { passwordChanged: true } });
  }

  if (session.status === 'loading') {
    return (
      <AuthLayout>
        <SkeletonList count={1} />
      </AuthLayout>
    );
  }

  if (session.status !== 'signedIn') {
    return (
      <AuthLayout>
        <Card>
          <div className={styles.stack}>
            <h1 className={styles.title}>{t('auth.reset.expiredTitle')}</h1>
            <p>{t('auth.reset.expiredBody')}</p>
            <Link to="/parola-uitata" className={styles.center}>
              {t('auth.reset.askAgain')}
            </Link>
          </div>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card>
        <form ref={formRef} className={styles.form} noValidate onSubmit={(e) => e.preventDefault()}>
          <h1 className={styles.title}>{t('auth.reset.title')}</h1>
          <PasswordField
            label={t('auth.newPassword')}
            autoComplete="new-password"
            showStrength
            hint={t('auth.passwordHint', { min: MIN_PASSWORD_LENGTH })}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          <PasswordField
            label={t('auth.confirmPassword')}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={errors.confirm}
          />
          <ActionButton submit onAction={save} errorMessage={(e) => authErrorMessage(lang, e)} canRetry={isRetryable}>
            {t('auth.reset.save')}
          </ActionButton>
        </form>
      </Card>
    </AuthLayout>
  );
}
