import { KeyRound, Mail } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../../app/sessionContext';
import { ActionButton } from '../../components/ActionButton';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { AuthFailure, authErrorMessage, cancelEmailChange, changeEmail, changePassword, isRetryable } from '../../data/auth';
import { useCaptcha } from '../../components/useCaptcha';
import { Field } from '../../components/Field';
import { PasswordField } from '../../components/PasswordField';
import { useI18n } from '../../i18n/context';
import { looksLikeEmail, MIN_PASSWORD_LENGTH } from '../../lib/password';
import styles from './account.module.css';

/** Change email (pending until confirmed; the old address keeps working), P4c. */
function EmailCard() {
  const { t, lang } = useI18n();
  const session = useSession();
  const current = session.user?.email ?? '';
  const pending = session.user?.new_email ?? null;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const invalid = !looksLikeEmail(email)
      ? t('auth.error.emailFormat')
      : email.trim().toLowerCase() === current.toLowerCase()
        ? t('account.email.same')
        : null;
    setError(invalid);
    if (invalid) return;
    await changeEmail(email);
    setOpen(false);
    setEmail('');
  }

  return (
    <Card>
      <div className={styles.row}>
        <span className={styles.rowLabel}>
          <Mail size={20} aria-hidden="true" />
          {t('auth.email')}
        </span>
        <span className={styles.value}>{current}</span>
      </div>
      {pending && (
        <div className={styles.panel}>
          <Banner>
            {t('account.email.pending', { email: pending })}
          </Banner>
          <ActionButton
            variant="secondary"
            onAction={async (requestId) => {
              await cancelEmailChange(requestId);
            }}
            errorMessage={(e) => authErrorMessage(lang, e)}
          >
            {t('account.email.cancel')}
          </ActionButton>
        </div>
      )}
      {!pending && !open && (
        <div className={styles.panel}>
          <Button block onClick={() => setOpen(true)}>
            {t('account.email.change')}
          </Button>
        </div>
      )}
      {!pending && open && (
        <form className={styles.panel} noValidate onSubmit={(e) => e.preventDefault()}>
          <Field
            label={t('account.email.new')}
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
            hint={t('account.email.hint')}
          />
          <div className={styles.buttons}>
            <ActionButton submit onAction={send} errorMessage={(e) => authErrorMessage(lang, e)} canRetry={isRetryable}>
              {t('account.email.send')}
            </ActionButton>
            <Button block onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

interface PasswordErrors {
  current?: string;
  next?: string;
  confirm?: string;
}

/** Change password while signed in: the current one is checked first (P4c). */
function PasswordCard() {
  const { t, lang } = useI18n();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [done, setDone] = useState(false);
  const captcha = useCaptcha();

  function reset() {
    setCurrent('');
    setNext('');
    setConfirm('');
    setErrors({});
  }

  async function save() {
    const e: PasswordErrors = {};
    if (current === '') e.current = t('auth.error.passwordRequired');
    if (next.length < MIN_PASSWORD_LENGTH) e.next = t('auth.error.passwordShort', { min: MIN_PASSWORD_LENGTH });
    else if (confirm !== next) e.confirm = t('auth.error.passwordMismatch');
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    if (!captcha.ready) throw new AuthFailure('captcha_failed');
    try {
      await changePassword(session.user?.email ?? '', current, next, captcha.token);
    } finally {
      captcha.reset();
    }
    reset();
    setOpen(false);
    setDone(true);
  }

  return (
    <Card>
      <div className={styles.row}>
        <span className={styles.rowLabel}>
          <KeyRound size={20} aria-hidden="true" />
          {t('account.password')}
        </span>
      </div>
      {done && !open && (
        <div className={styles.panel}>
          <Banner>{t('account.password.changed')}</Banner>
        </div>
      )}
      {!open && (
        <div className={styles.panel}>
          <Button
            block
            onClick={() => {
              setDone(false);
              setOpen(true);
            }}
          >
            {t('account.password.change')}
          </Button>
        </div>
      )}
      {open && (
        <form className={styles.panel} noValidate onSubmit={(e) => e.preventDefault()}>
          <PasswordField
            label={t('account.password.current')}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            error={errors.current}
          />
          <PasswordField
            label={t('auth.newPassword')}
            autoComplete="new-password"
            showStrength
            hint={t('auth.passwordHint', { min: MIN_PASSWORD_LENGTH })}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            error={errors.next}
          />
          <PasswordField
            label={t('auth.confirmPassword')}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={errors.confirm}
          />
          {captcha.element}
          <div className={styles.buttons}>
            <ActionButton submit onAction={save} errorMessage={(e) => authErrorMessage(lang, e)} canRetry={isRetryable}>
              {t('account.password.save')}
            </ActionButton>
            <Button
              block
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

export function SecuritySection() {
  const { t } = useI18n();
  return (
    <>
      <h2 className={styles.section}>{t('account.security')}</h2>
      <div className={styles.cardStack}>
        <EmailCard />
        <PasswordCard />
      </div>
    </>
  );
}
