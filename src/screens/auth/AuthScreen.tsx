import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Banner } from '../../components/Banner';
import { Tabs } from '../../components/Tabs';
import { useI18n } from '../../i18n/context';
import { AuthLayout } from './AuthLayout';
import { LegalDocScreen } from './LegalDocScreen';
import { SIGNUP_ROLE_PARAM } from './paths';
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
 * "Autentificare" / "Cont nou" (P4b). A legal document opens as a screen of its own; the form is
 * hidden meanwhile and keeps its data.
 */
export function AuthScreen({ tab }: { tab: AuthTab }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as AuthLocationState;
  const [params] = useSearchParams();
  const roleParam = params.get(SIGNUP_ROLE_PARAM);
  const initialRole = roleParam === 'client' ? 'client' : roleParam === 'service' ? 'shop' : undefined;
  const [email, setEmail] = useState(state.email ?? '');
  const { doc, open: openDoc, close: closeDoc } = useLegalDoc();

  return (
    <AuthLayout title={t(tab === 'signin' ? 'auth.tab.signin' : 'auth.tab.signup')}>
      {doc && <LegalDocScreen doc={doc} onBack={closeDoc} />}
      <div className={styles.stack} hidden={doc !== null}>
        <h1 className="visually-hidden">{t(tab === 'signin' ? 'auth.tab.signin' : 'auth.tab.signup')}</h1>
        <Tabs
          segmented
          label={t('auth.tabs')}
          items={[
            { key: 'signin', label: t('auth.tab.signin') },
            { key: 'signup', label: t('auth.tab.signup') },
          ]}
          value={tab}
          onChange={(next) =>
            navigate(next === 'signin' ? '/intra' : '/cont-nou', { replace: true, state: { ...state, email } })
          }
        />
        {state.linkError && <Banner tone="warning">{t('auth.linkExpired')}</Banner>}
        {tab === 'signin' ? (
          <SignInForm email={email} setEmail={setEmail} />
        ) : (
          <SignUpForm email={email} setEmail={setEmail} onOpenDoc={openDoc} initialRole={initialRole} />
        )}
      </div>
    </AuthLayout>
  );
}
