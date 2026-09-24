import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Tabs } from '../../components/Tabs';
import { useI18n } from '../../i18n/context';
import { LEGAL_DOCS, type LegalDocId } from '../../lib/legal';
import { LegalDocument } from '../legal/LegalDocument';
import { AuthLayout } from './AuthLayout';
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

/** "Autentificare" / "Cont nou" (P4b). The legal documents open in place, the form keeps its data. */
export function AuthScreen({ tab }: { tab: AuthTab }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as AuthLocationState;
  const [email, setEmail] = useState(state.email ?? '');
  const [doc, setDoc] = useState<LegalDocId | null>(null);
  const docTitle = LEGAL_DOCS.find((d) => d.id === doc)?.titleKey;

  return (
    <AuthLayout>
      {doc && docTitle && (
        <div className={styles.stack}>
          <div className={styles.docTop}>
            <Button onClick={() => setDoc(null)}>{t('auth.backToForm')}</Button>
          </div>
          <LegalDocument id={doc} title={t(docTitle)} />
          <Button variant="primary" block onClick={() => setDoc(null)}>
            {t('auth.backToForm')}
          </Button>
        </div>
      )}
      <div className={styles.stack} hidden={doc !== null}>
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
          <SignUpForm email={email} setEmail={setEmail} onOpenDoc={setDoc} />
        )}
      </div>
    </AuthLayout>
  );
}
