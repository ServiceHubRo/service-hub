import { MailCheck } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Card } from '../../components/Card';
import { useI18n } from '../../i18n/context';
import { AuthLayout } from './AuthLayout';
import { ResendConfirmation } from './ResendConfirmation';
import styles from './auth.module.css';

/** After sign-up: the account waits for the email link (valid 24 h). */
export function CheckEmail() {
  const { t } = useI18n();
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email;
  if (!email) return <Navigate to="/intra" replace />;

  return (
    <AuthLayout>
      <Card>
        <div className={styles.stack}>
          <div className={styles.center}>
            <MailCheck size={36} color="var(--amber)" aria-hidden="true" />
          </div>
          <h1 className={styles.title}>{t('auth.checkEmail.title')}</h1>
          <p>{t('auth.checkEmail.body', { email })}</p>
          <p className={styles.note}>{t('auth.checkEmail.spam')}</p>
          <ResendConfirmation email={email} />
        </div>
      </Card>
      <div className={styles.links}>
        <Link to="/intra" state={{ email }}>
          {t('auth.backToSignIn')}
        </Link>
      </div>
    </AuthLayout>
  );
}
