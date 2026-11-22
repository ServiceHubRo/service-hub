import { useSyncExternalStore } from 'react';
import { FLEET_BOOKING_EVENT, fleetBookingContext, type FleetBookingContext } from './fleetBookingHint';

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

/** The booking for a company the member started from its fleet space, or null; follows its being set and cleared. */
export function useFleetBookingContext(): FleetBookingContext | null {
  const raw = useSyncExternalStore(subscribe, read, () => '');
  return raw ? fleetBookingContext() : null;
}
