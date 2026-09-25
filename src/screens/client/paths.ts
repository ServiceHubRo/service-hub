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

/** Vehicle history (T10, P16c): one screen, three ways in — the garage card, Cont, a finished booking. */
export const VEHICLE_HISTORY_PICK_PATH = '/c/cont/istoric';

export function carHistoryPath(carId: string): string {
  return `${GARAGE_PATH}/${carId}/istoric`;
}

/** The history of the car a booking was for (also a car no longer in the garage). */
export function bookingCarHistoryPath(bookingId: string): string {
  return `${BOOKINGS_PATH}/${bookingId}/istoric`;
}

/** Router state of a link into the vehicle history: where "Înapoi" leads. */
export interface VehicleHistoryLinkState {
  from: 'garage' | 'bookings' | 'account';
}

/** The paid history report (T15, P16e): Cont → Rapoartele mele, and the preview of one car's report. */
export const MY_REPORTS_PATH = '/c/cont/rapoarte';

export function carReportPath(carId: string): string {
  return `${GARAGE_PATH}/${carId}/raport`;
}

/** The report of the car a booking was for (also a car no longer in the garage). */
export function bookingReportPath(bookingId: string): string {
  return `${BOOKINGS_PATH}/${bookingId}/raport`;
}

/** Router state of a link into the report preview: where "Înapoi" leads. */
export interface ReportLinkState {
  from: 'history' | 'garage' | 'reports';
}
