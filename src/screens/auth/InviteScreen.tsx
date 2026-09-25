import { useCallback } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useSession } from '../../app/sessionContext';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { SkeletonList } from '../../components/Skeleton';
import { getStaffInvite } from '../../data/shop';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import { LoadError } from '../../components/LoadError';
import { AuthLayout } from './AuthLayout';
import { LegalDocScreen } from './LegalDocScreen';
import { useLegalDoc } from './useLegalDoc';
import { SignUpForm } from './SignUpForm';
import styles from './auth.module.css';

/**
 * /invitatie/:token — a shop owner's invitation to work in their account (FR §4.6). The invited
 * address creates a shop account here and joins that shop; the database checks the token and the
 * address again at sign-up.
 */
export function InviteScreen() {
  const { t } = useI18n();
  const { token = '' } = useParams();
  const session = useSession();
  const load = useCallback(() => getStaffInvite(token), [token]);
  const { state, reload } = useLoad(load);
  const { doc, open: openDoc, close: closeDoc } = useLegalDoc();

  let body;
  if (state.status === 'loading' || session.status === 'loading') body = <SkeletonList count={1} />;
  else if (state.status === 'error') body = <LoadError message={t('invite.loadError')} onRetry={reload} />;
  else if (!state.data) {
    body = (
      <>
        <Banner tone="warning">{t('invite.invalid')}</Banner>
        <Link to="/" className={styles.linkButton}>
          {t('app.title')}
        </Link>
      </>
    );
  } else if (session.status === 'signedIn' && session.user?.email?.toLowerCase() === state.data.email.toLowerCase()) {
    // Already signed in as the invited address (e.g. email confirmation turned off).
    return <Navigate to="/s/panou" replace />;
  } else if (session.status === 'signedIn' || session.status === 'expired') {
    body = (
      <>
        <Banner tone="info">{t('invite.signedIn')}</Banner>
        <Button block onClick={() => void session.signOut()}>
          {t('nav.logout')}
        </Button>
      </>
    );
  } else {
    const invite = state.data;
    body = (
      <>
        {doc && <LegalDocScreen doc={doc} onBack={closeDoc} />}
        <div className={styles.stack} hidden={doc !== null}>
          <Banner tone="info">
            {t('invite.body', { shop: invite.shop_name, city: invite.city, email: invite.email })}
          </Banner>
          <SignUpForm email={invite.email} setEmail={() => undefined} onOpenDoc={openDoc} invite={{ token, email: invite.email }} />
        </div>
      </>
    );
  }

  return (
    <AuthLayout>
      <div className={styles.stack}>
        <h1 className={styles.inviteTitle}>{t('invite.title')}</h1>
        {body}
      </div>
    </AuthLayout>
  );
}
