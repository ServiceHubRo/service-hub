import { useCallback } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useSession } from '../../app/sessionContext';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { buttonClass } from '../../components/buttonClass';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { claimPath, invitePreview, isInviteToken, rememberClaim } from '../../data/claim';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import { AuthLayout } from '../auth/AuthLayout';
import { signUpPath } from '../auth/paths';
import { BOOKINGS_PATH } from '../client/paths';
import { InviteSummary } from './InviteSummary';
import styles from './BookingLink.module.css';

/**
 * /p/:token — the link in the SMS a shop sends when it adds a booking for a client without an
 * account (T29). It shows what the booking is about (no personal data) and leads to creating an
 * account or signing in; a client already signed in goes straight to taking it into the account.
 */
export function BookingLinkScreen() {
  const { t } = useI18n();
  const token = useParams().token ?? '';
  const session = useSession();
  const valid = isInviteToken(token);
  const load = useCallback(() => (valid ? invitePreview(token) : Promise.resolve(null)), [valid, token]);
  const { state, reload } = useLoad(load);

  let body;
  if (state.status === 'loading' || session.status === 'loading') body = <SkeletonList count={1} />;
  else if (state.status === 'error') body = <LoadError message={t('lk.loadError')} onRetry={reload} />;
  else if (!state.data || !valid) {
    body = (
      <>
        <Banner tone="warning">{t('lk.invalid')}</Banner>
        <Link to="/" className={buttonClass('secondary', true)}>
          {t('app.title')}
        </Link>
      </>
    );
  } else {
    const preview = state.data;
    const signedIn = session.status === 'signedIn';
    if (signedIn && session.role === 'client') {
      return <Navigate to={preview.mine ? BOOKINGS_PATH : claimPath(token)} replace />;
    }
    const from = { from: claimPath(token) };
    body = (
      <>
        <InviteSummary preview={preview} />
        {signedIn ? (
          <>
            <Banner tone="info">{t('lk.otherRole')}</Banner>
            <Button block onClick={() => void session.signOut()}>
              {t('nav.logout')}
            </Button>
          </>
        ) : preview.claimed ? (
          <>
            <Banner tone="info">{t('lk.used')}</Banner>
            <Link to="/intra" state={from} className={buttonClass('primary', true)}>
              {t('lk.signin')}
            </Link>
          </>
        ) : (
          <>
            <p className={styles.why}>{t('lk.why')}</p>
            <div className={styles.buttons}>
              <Link
                to={signUpPath('client')}
                state={from}
                className={buttonClass('primary', true)}
                onClick={() => rememberClaim(token)}
              >
                {t('lk.signup')}
              </Link>
              <Link to="/intra" state={from} className={buttonClass('secondary', true)} onClick={() => rememberClaim(token)}>
                {t('lk.signin')}
              </Link>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <AuthLayout title={t('lk.title')}>
      <div className={styles.buttons}>
        <h1 className={styles.shop}>{t('lk.title')}</h1>
        {body}
      </div>
    </AuthLayout>
  );
}
