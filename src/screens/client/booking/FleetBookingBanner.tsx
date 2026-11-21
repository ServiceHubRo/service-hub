import { Building2 } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { buttonClass } from '../../../components/buttonClass';
import { useI18n } from '../../../i18n/context';
import { clearFleetBookingContext, FLEET_BOOKING_EVENT, fleetBookingContext, fleetBookingsPath } from './fleetBookingHint';
import styles from './booking.module.css';

// The context lives in the tab's storage: read as a string so that React sees a stable value.
const read = () => {
  try {
    return sessionStorage.getItem('sh.fleetBook') ?? '';
  } catch {
    return '';
  }
};
const subscribe = (notify: () => void) => {
  window.addEventListener(FLEET_BOOKING_EVENT, notify);
  window.addEventListener('storage', notify);
  return () => {
    window.removeEventListener(FLEET_BOOKING_EVENT, notify);
    window.removeEventListener('storage', notify);
  };
};

/**
 * „Programezi pentru <firma>” (C17): on every screen of a booking started from a company's fleet space
 * (the search, the shop page, the booking steps), so the person knows whose booking it is — the search
 * is the same as a person's — with the way back to the fleet and „Renunță”.
 */
export function FleetBookingBanner() {
  const { t } = useI18n();
  const raw = useSyncExternalStore(subscribe, read, () => '');
  const context = raw ? fleetBookingContext() : null;
  if (!context) return null;
  return (
    <Banner tone="info" icon={<Building2 size={18} aria-hidden="true" />}>
      <p className={styles.fleetBannerTitle}>{t('fleetBook.title', { company: context.companyName })}</p>
      <p className={styles.fleetBannerLine}>
        {context.vehicleLabel ? t('fleetBook.vehicle', { vehicle: context.vehicleLabel }) : t('fleetBook.pickVehicle')}
      </p>
      <div className={styles.fleetBannerActions}>
        <Link to={fleetBookingsPath(context.companyId)} className={buttonClass('secondary', false)} onClick={clearFleetBookingContext}>
          {t('fleetBook.back')}
        </Link>
        <Button variant="secondary" onClick={clearFleetBookingContext}>
          {t('fleetBook.quit')}
        </Button>
      </div>
    </Banner>
  );
}
