/** Client routes of the search area (T06). */
export const SEARCH_PATH = '/c/cauta';
export const FAVORITES_PATH = '/c/cont/favorite';
export const GARAGE_PATH = '/c/garaj';
export const NEW_CAR_PATH = '/c/garaj/nou';
export const BOOKINGS_PATH = '/c/programari';

export function carPath(carId: string): string {
  return `${GARAGE_PATH}/${carId}`;
}

export function shopPath(shopId: string): string {
  return `/c/service/${shopId}`;
}

export function bookingPath(shopId: string): string {
  return `/c/service/${shopId}/programare`;
}

/** The success screen after a booking request; replaces the flow in the history. */
export function bookingSentPath(shopId: string): string {
  return `${bookingPath(shopId)}/trimisa`;
}

/** Router state a link to the shop page carries, so "Înapoi" returns to the exact list. */
export interface ShopLinkState {
  backTo: string;
  backLabel: 'search' | 'favorites';
}
