import { ShieldCheck } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { useSession } from '../../app/sessionContext';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { mfaState, startEnrollment, verifyCode, type Enrollment, type MfaState } from '../../data/mfa';
import { rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import { AuthLayout } from '../auth/AuthLayout';
import styles from './mfa.module.css';

/**
 * The admin interface opens only after the second step of sign-in (T25): the code from an
 * authenticator app, or, the first time, setting the app up. The database refuses admin work to
 * a session without it (is_admin, require_admin), so this screen only leads the way.
 */
export function MfaGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const load = useCallback(() => mfaState(), []);
  const { state, reload } = useLoad(load);
  const [passed, setPassed] = useState(false);

  if (passed || (state.status === 'ready' && state.data.step === 'done')) return <>{children}</>;
  return (
    <AuthLayout title={t('mfa.title')}>
      {state.status === 'loading' && <SkeletonList count={1} />}
      {state.status === 'error' && <LoadError message={t('mfa.loadError')} onRetry={reload} />}
      {state.status === 'ready' && <MfaStep state={state.data} onPassed={() => setPassed(true)} />}
    </AuthLayout>
  );
}

function MfaStep({ state, onPassed }: { state: MfaState; onPassed: () => void }) {
  const { t, lang } = useI18n();
  const session = useSession();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(false);
  const factorId = state.step === 'challenge' ? state.factorId : enrollment?.factorId;

  async function confirm() {
    if (!factorId) return;
    if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) {
      setWrong(true);
      return;
    }
    if (await verifyCode(factorId, code)) onPassed();
    else setWrong(true);
  }

  return (
    <div className={styles.stack}>
      <h1 className={styles.title}>
        <ShieldCheck size={22} aria-hidden="true" />
        {t('mfa.title')}
      </h1>
      {state.step === 'challenge' && <p className={styles.muted}>{t('mfa.challenge')}</p>}
      {state.step === 'enroll' && !enrollment && (
        <>
          <p className={styles.muted}>{t('mfa.enrollIntro')}</p>
          <ActionButton onAction={async () => setEnrollment(await startEnrollment())} errorMessage={(e) => rpcErrorMessage(lang, e)}>
            {t('mfa.start')}
          </ActionButton>
        </>
      )}
      {enrollment && (
        <>
          <p className={styles.muted}>{t('mfa.scan')}</p>
          <img className={styles.qr} src={enrollment.qr} width={200} height={200} alt={t('mfa.qrAlt')} />
          <p className={styles.muted}>{t('mfa.manual')}</p>
          <p className={`${styles.secret} mono`}>{enrollment.secret}</p>
        </>
      )}
      {factorId && (
        <form className={styles.stack} noValidate onSubmit={(e) => e.preventDefault()}>
          <Field
            label={t('mfa.code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            mono
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setWrong(false);
            }}
            error={wrong ? t('mfa.wrong') : null}
          />
          <ActionButton submit onAction={confirm} errorMessage={(e) => rpcErrorMessage(lang, e)}>
            {t(state.step === 'enroll' ? 'mfa.activate' : 'mfa.confirm')}
          </ActionButton>
        </form>
      )}
      <p className={styles.muted}>{t('mfa.lost')}</p>
      <Button variant="secondary" onClick={() => void session.signOut()}>
        {t('mfa.signOut')}
      </Button>
    </div>
  );
}
