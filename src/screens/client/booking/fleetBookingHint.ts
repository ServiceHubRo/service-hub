/**
 * "Programează la service" from a company's fleet space (T63d, C17): the company the member is booking
 * for and, when it came from a vehicle, that vehicle (to pick on the car step), kept for this tab while
 * the member searches for a shop and goes through the booking. The search is the same as a person's
 * (there is one marketplace), so every screen on the way says whose booking it is
 * (FleetBookingBanner) and how to get back to the fleet. A convenience only: the car step shows every
 * company vehicle the member may book anyway, and the database checks the right again.
 */
const KEY = 'sh.fleetBook';
/** Told to the banners of an open screen when the context is set or cleared. */
const EVENT = 'sh-fleet-book';

export interface FleetBookingContext {
  companyId: string;
  companyName: string;
  /** The vehicle the member started from, to pick on the car step; null from „Programează la service” of Programări. */
  vehicleId: string | null;
  /** How the vehicle is named (plate, make and model). */
  vehicleLabel: string | null;
}

export function setFleetBookingContext(context: FleetBookingContext): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(context));
  } catch {
    // Storage blocked: the member picks the vehicle on the car step, and no banner says whose booking it is.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function fleetBookingContext(): FleetBookingContext | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<FleetBookingContext>;
    if (typeof c.companyId !== 'string' || typeof c.companyName !== 'string') return null;
    return { companyId: c.companyId, companyName: c.companyName, vehicleId: c.vehicleId ?? null, vehicleLabel: c.vehicleLabel ?? null };
  } catch {
    return null;
  }
}

export function clearFleetBookingContext(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The vehicle to pick on the car step. */
export function fleetBookingHint(): string | null {
  return fleetBookingContext()?.vehicleId ?? null;
}

export const FLEET_BOOKING_EVENT = EVENT;

/** The company's own place of bookings in its fleet space. */
export const fleetBookingsPath = (companyId: string) => `/c/firme/${companyId}?sectiune=programari`;

/** The screens of a booking started from a fleet: the search and the shop's pages (the company's frame stays around them). */
export const isFleetBookingPath = (pathname: string) => pathname === '/c/cauta' || pathname.startsWith('/c/cauta/') || pathname.startsWith('/c/service/');
