import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../../../app/sessionContext';
import { ActionButton } from '../../../components/ActionButton';
import { Banner } from '../../../components/Banner';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { claimBooking, forgetClaim, invitePreview, isInviteToken } from '../../../data/claim';
import { canRetryRpc, rpcErrorMessage, toRpcError } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { useLoad } from '../../../lib/useLoad';
import { PhoneVerify } from '../../phone/PhoneVerify';
import { InviteSummary } from '../../public/InviteSummary';
import { BOOKINGS_PATH } from '../paths';
import styles from '../../public/BookingLink.module.css';

/**
 * /c/preia/:token (T29): a booking a shop added for this client, taken into the account with one
 * tap. The database matches the account's verified phone or email with the ones the shop typed;
 * when only the phone matches and it is not confirmed yet, the SMS code panel opens right here.
 * All the bookings shops added for that phone come along, with the car in the garage.
 */
export function ClaimScreen() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const session = useSession();
  const token = useParams().token ?? '';
  const valid = isInviteToken(token);
  const load = useCallback(() => (valid ? invitePreview(token) : Promise.resolve(null)), [valid, token]);
  const { state, reload } = useLoad(load);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [phoneDone, setPhoneDone] = useState(false);

  // The link was opened: the client app need not bring the visitor here again.
  useEffect(() => forgetClaim(), []);

  async function claim() {
    try {
      await claimBooking(token);
      navigate(BOOKINGS_PATH, { replace: true });
    } catch (e) {
      if (toRpcError(e).code === 'phone_not_verified') {
        setNeedsPhone(true);
        return;
      }
      throw e;
    }
  }

  let body;
  if (state.status === 'loading') body = <SkeletonList count={1} />;
  else if (state.status === 'error') body = <LoadError message={t('lk.loadError')} onRetry={reload} />;
  else if (!state.data) {
    body = (
      <>
        <Banner tone="warning">{t('lk.invalid')}</Banner>
        <Link to={BOOKINGS_PATH} className={buttonClass('secondary', true)}>
          {t('cl.toBookings')}
        </Link>
      </>
    );
  } else if (state.data.mine) {
    return <Navigate to={BOOKINGS_PATH} replace />;
  } else {
    const phone = session.profile?.phone;
    body = (
      <>
        <InviteSummary preview={state.data} />
        {state.data.claimed ? (
          <>
            <Banner tone="warning">{t('rpcError.invite_used')}</Banner>
            <Link to={BOOKINGS_PATH} className={buttonClass('secondary', true)}>
              {t('cl.toBookings')}
            </Link>
          </>
        ) : needsPhone && !phoneDone ? (
          <Card className={styles.card}>
            <p>{t('cl.phone')}</p>
            {phone ? (
              <PhoneVerify
                phone={phone}
                onVerified={async () => {
                  setPhoneDone(true);
                  await session.refreshProfile();
                }}
              />
            ) : (
              <p>{t('booking.phone.missing')}</p>
            )}
          </Card>
        ) : (
          <>
            <p className={styles.why}>{t('cl.why')}</p>
            <ActionButton onAction={claim} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
              {t('cl.submit')}
            </ActionButton>
          </>
        )}
      </>
    );
  }

  return (
    <div className={styles.buttons}>
      <h1>{t('cl.title')}</h1>
      {body}
    </div>
  );
}
