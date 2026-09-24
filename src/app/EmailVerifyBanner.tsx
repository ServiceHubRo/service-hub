import { Banner } from '../components/Banner';
import { useI18n } from '../i18n/context';
import { ResendConfirmation } from '../screens/auth/ResendConfirmation';
import type { Role } from './roles';
import styles from './EmailVerifyBanner.module.css';
import { useSession } from './sessionContext';

/**
 * Until the email is confirmed a client cannot book and a shop does not appear in search
 * (enforced in the database; this banner explains it). Supabase normally signs people in only
 * after confirmation, so this shows only if confirmation is turned off or an account was imported.
 */
export function EmailVerifyBanner({ role }: { role: Role }) {
  const { t } = useI18n();
  const session = useSession();
  const email = session.user?.email;
  if (session.status !== 'signedIn' || session.emailVerified || role === 'admin' || !email) return null;
  return (
    <div className={styles.wrap}>
      <Banner tone="warning">
        <div className={styles.stack}>
          <span>{t(role === 'shop' ? 'verify.shop' : 'verify.client', { email })}</span>
          <ResendConfirmation email={email} />
        </div>
      </Banner>
    </div>
  );
}
