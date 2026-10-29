import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { BackLink } from '../../../components/BackLink';
import { Card } from '../../../components/Card';
import { IntakeView } from '../../../components/intake/IntakeView';
import { momentText } from '../../../lib/moment';
import { JobDocuments } from '../../../components/JobDocuments';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { confirmIntake, fetchIntake } from '../../../data/jobDocs';
import { canRetryRpc, rpcErrorMessage } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { useLoad } from '../../../lib/useLoad';
import { useClientBookings } from '../bookings/clientBookingsContext';
import { BOOKINGS_PATH } from '../paths';
import styles from '../../../components/intake/Intake.module.css';

/**
 * The intake sheet of a booking, for the client (T50): what the shop wrote when the car came in
 * (odometer, fuel, damage on the drawing, photos, items left in the car, the options). "Confirm"
 * records the client's agreement; the sheet no longer changes after that. Anything wrong is told
 * to the shop in Mesaje.
 */
export function ClientIntakeScreen() {
  const { bookingId = '' } = useParams();
  const { t, lang } = useI18n();
  const { state: bookings, refresh } = useClientBookings();
  const load = useCallback(() => fetchIntake(bookingId), [bookingId]);
  const { state, reload, setData } = useLoad(load);
  const back = `${BOOKINGS_PATH}?p=${encodeURIComponent(bookingId)}`;
  const booking = bookings.status === 'ready' ? bookings.data.bookings.find((b) => b.id === bookingId) ?? null : null;

  let body;
  if (state.status === 'loading' || bookings.status === 'loading') body = <SkeletonList count={3} />;
  else if (state.status === 'error') body = <LoadError message={t('in.loadError')} onRetry={reload} />;
  else if (!state.data || !booking) body = <p className={styles.muted}>{t('cin.none')}</p>;
  else {
    const sheet = state.data;
    const car = [booking.car_snapshot.make, booking.car_snapshot.model].filter(Boolean).join(' ');
    body = (
      <>
        <Card className={styles.head}>
          <p className={styles.car}>
            {car}
            {booking.car_snapshot.plate && <span className="mono"> · {booking.car_snapshot.plate}</span>}
          </p>
          <p className={styles.muted}>
            {booking.shop?.name} · {booking.ref}
          </p>
        </Card>
        {sheet.confirmed_at && <p className={styles.confirmed}>{t('cin.confirmedAt', { when: momentText(lang, sheet.confirmed_at) })}</p>}
        <IntakeView intake={sheet} />
        {!sheet.confirmed_at && (
          <div className={styles.section}>
            <p className={styles.muted}>{t('cin.ask')}</p>
            <div className={styles.buttons}>
              <ActionButton
                variant="success"
                block={false}
                onAction={async (rid) => {
                  setData(await confirmIntake(bookingId, rid));
                  refresh();
                }}
                errorMessage={(e) => rpcErrorMessage(lang, e)}
                canRetry={canRetryRpc}
              >
                {t('cin.confirm')}
              </ActionButton>
            </div>
          </div>
        )}
        <JobDocuments bookingId={booking.id} bookingRef={booking.ref} quoteNumber={booking.quote_number} kinds={['intake']} />
      </>
    );
  }

  return (
    <div className={styles.page}>
      <BackLink to={back} label={t('nav.bookings')} />
      <h1>{t('cin.title')}</h1>
      {body}
    </div>
  );
}
