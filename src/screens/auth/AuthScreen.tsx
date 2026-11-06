import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Banner } from '../../components/Banner';
import { takeAuthLinkError } from '../../data/supabase';
import { useI18n } from '../../i18n/context';
import { AuthLayout } from './AuthLayout';
import { SocialSignIn } from './SocialSignIn';
import { LegalDocScreen } from './LegalDocScreen';
import { REFERRAL_CODE_PARAM, SIGNUP_ROLE_PARAM } from './paths';
import { useLegalDoc } from './useLegalDoc';
import { SignInForm } from './SignInForm';
import { SignUpForm } from './SignUpForm';
import styles from './auth.module.css';

export type AuthTab = 'signin' | 'signup';

export interface AuthLocationState {
  email?: string;
  /** Where to go after signing in (a protected page the visitor tried to open). */
  from?: string;
  /** An email link turned out expired or already used. */
  linkError?: boolean;
}

/**
 * "Autentificare" / "Cont nou" (P4b), each with a link to the other. A legal document opens as a screen of its own; the form is
 * hidden meanwhile and keeps its data.
 */
export function AuthScreen({ tab }: { tab: AuthTab }) {
  const { t } = useI18n();
  const location = useLocation();
  const state = (location.state ?? {}) as AuthLocationState;
  const [params] = useSearchParams();
  const roleParam = params.get(SIGNUP_ROLE_PARAM);
  const initialRole = roleParam === 'client' ? 'client' : roleParam === 'service' ? 'shop' : undefined;
  const referralCode = params.get(REFERRAL_CODE_PARAM)?.slice(0, 16) ?? undefined;
  const [email, setEmail] = useState(state.email ?? '');
  const { doc, open: openDoc, close: closeDoc } = useLegalDoc();
  // Back from Google or Apple without signing in (refused, or the window closed): Auth puts the error in the address.
  const [socialFailed] = useState(() => takeAuthLinkError() !== null || params.has('error'));

  return (
    <AuthLayout title={t(tab === 'signin' ? 'auth.tab.signin' : 'auth.tab.signup')}>
      {doc && <LegalDocScreen doc={doc} onBack={closeDoc} />}
      <div className={styles.stack} hidden={doc !== null}>
        {/* One form at a time, the other one a link away (Eduard, 6 Nov: no tabs). */}
        <div className={styles.head}>
          <h1 className={styles.title}>{t(tab === 'signin' ? 'auth.tab.signin' : 'auth.tab.signup')}</h1>
          <p className={styles.switch}>
            {t(tab === 'signin' ? 'auth.switch.noAccount' : 'auth.switch.haveAccount')}{' '}
            <Link
              // The role and a referral code stay in the address, for coming back to Cont nou.
              to={`${tab === 'signin' ? '/cont-nou' : '/intra'}${location.search}`}
              replace
              state={{ ...state, email }}
              className={styles.switchLink}
            >
              {t(tab === 'signin' ? 'auth.switch.toSignup' : 'auth.switch.toSignin')}
            </Link>
          </p>
        </div>
        {state.linkError && <Banner tone="warning">{t('auth.linkExpired')}</Banner>}
        {socialFailed && <Banner tone="warning">{t('auth.social.failed')}</Banner>}
        <SocialSignIn role={initialRole} referral={referralCode} />
        {tab === 'signin' ? (
          <SignInForm email={email} setEmail={setEmail} />
        ) : (
          <SignUpForm
            email={email}
            setEmail={setEmail}
            onOpenDoc={openDoc}
            initialRole={initialRole}
            initialReferral={referralCode}
          />
        )}
      </div>
    </AuthLayout>
  );
}
