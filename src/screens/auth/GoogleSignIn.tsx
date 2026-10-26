import { useEffect, useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { authErrorMessage, googleSignInAvailable, isRetryable, signInWithGoogle } from '../../data/auth';
import { useI18n } from '../../i18n/context';
import { rememberGoogleSignUp, type SignUpRole } from './googleSignUp';
import styles from './auth.module.css';

// Asked once, as the app starts, so the button is there when Intră or Cont nou opens.
let known: boolean | null = null;
if (typeof window !== 'undefined') void googleSignInAvailable().then((ok) => (known = ok));

/** Google's own "G", in its colors (Google's sign-in button rules). */
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" className={styles.googleLogo}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * "Continuă cu Google" above the email form (T48), only where the Supabase project has Google
 * turned on. On Cont nou, the role and code already chosen wait for "Finalizează contul".
 */
export function GoogleSignIn({ role, referral }: { role?: SignUpRole | null; referral?: string }) {
  const { t, lang } = useI18n();
  const [available, setAvailable] = useState(known === true);
  useEffect(() => {
    let live = true;
    void googleSignInAvailable().then((ok) => {
      if (live) setAvailable(ok);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!available) return null;

  return (
    <div className={styles.google}>
      <ActionButton
        variant="secondary"
        onAction={async () => {
          rememberGoogleSignUp({ role: role ?? undefined, referral: referral?.trim() || undefined });
          await signInWithGoogle();
          // The browser is leaving for Google: the button stays busy meanwhile.
          await new Promise((resolve) => window.setTimeout(resolve, 10_000));
        }}
        errorMessage={(e) => authErrorMessage(lang, e)}
        canRetry={isRetryable}
      >
        <span className={styles.googleLabel}>
          <GoogleLogo />
          {t('auth.google')}
        </span>
      </ActionButton>
      <p className={styles.or}>
        <span>{t('auth.or')}</span>
      </p>
    </div>
  );
}
