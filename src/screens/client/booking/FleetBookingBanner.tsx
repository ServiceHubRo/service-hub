import { Building2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Banner } from '../../../components/Banner';
import { buttonClass } from '../../../components/buttonClass';
import { useI18n } from '../../../i18n/context';
import { clearFleetBookingContext, fleetBookingOrigin, fleetBookingsPath } from './fleetBookingHint';
import { useFleetBookingContext } from './useFleetBookingContext';
import styles from './booking.module.css';

/**
 * „Programezi pentru <firma>” (C17): on every screen of a booking started from a company's fleet space
 * (the search, the shop page, the booking steps), so the person knows whose booking it is — the search
 * is the same as a person's — with the way back to the fleet and „Renunță”.
 */
export function FleetBookingBanner() {
  const { t } = useI18n();
  const context = useFleetBookingContext();
  if (!context) return null;
  return (
    <Banner tone="info" icon={<Building2 size={18} aria-hidden="true" />}>
      <div className={styles.fleetBannerRow}>
        <div className={styles.fleetBannerText}>
          <p className={styles.fleetBannerTitle}>{t('fleetBook.title', { company: context.companyName })}</p>
          <p className={styles.fleetBannerLine}>
            {context.vehicleLabel ? t('fleetBook.vehicle', { vehicle: context.vehicleLabel }) : t('fleetBook.pickVehicle')}
          </p>
        </div>
        <div className={styles.fleetBannerActions}>
          <Link to={fleetBookingsPath(context.companyId)} className={buttonClass('secondary', false)} onClick={clearFleetBookingContext}>
            {t('fleetBook.back')}
          </Link>
          <Link to={fleetBookingOrigin(context)} className={buttonClass('secondary', false)} onClick={clearFleetBookingContext}>
            {t('fleetBook.quit')}
          </Link>
        </div>
      </div>
    </Banner>
  );
}
