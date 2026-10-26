import { useState } from 'react';
import { useSession } from '../../app/sessionContext';
import { Button } from '../../components/Button';
import { useI18n } from '../../i18n/context';
import { AuthLayout } from './AuthLayout';
import { recallGoogleSignUp } from './googleSignUp';
import { LegalDocScreen } from './LegalDocScreen';
import { SignUpForm } from './SignUpForm';
import { useLegalDoc } from './useLegalDoc';
import styles from './auth.module.css';

/**
 * "Finalizează contul" (T48): signed in through Google for the first time. The same questions as
 * the email form, without email and password; until the account exists, no other screen opens.
 */
export function CompleteSignUp() {
  const { t } = useI18n();
  const session = useSession();
  const { doc, open: openDoc, close: closeDoc } = useLegalDoc();
  const [choice] = useState(recallGoogleSignUp);
  const meta = session.user?.user_metadata ?? {};
  const googleName = typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : '';
  const email = session.user?.email ?? '';

  return (
    <AuthLayout title={t('auth.complete.title')}>
      {doc && <LegalDocScreen doc={doc} onBack={closeDoc} />}
      <div className={styles.stack} hidden={doc !== null}>
        <h1 className={styles.inviteTitle}>{t('auth.complete.title')}</h1>
        <p className={`${styles.note} ${styles.center}`}>{t('auth.complete.connected', { email })}</p>
        <SignUpForm
          email={email}
          setEmail={() => undefined}
          onOpenDoc={openDoc}
          google={{ name: googleName }}
          initialRole={choice.role}
          initialReferral={choice.referral}
        />
        <Button variant="ghost" block onClick={() => void session.signOut()}>
          {t('auth.complete.cancel')}
        </Button>
      </div>
    </AuthLayout>
  );
}
