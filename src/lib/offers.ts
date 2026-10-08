/**
 * Offers (Eduard, 8 Oct): what the cards, the shop page and the booking steps show. The database
 * decides the promise when a booking is made (booking_offer: the larger offer, at most 15 %); this
 * mirrors it to show the same figure beforehand.
 */
export interface NamedServiceRef {
  id: string;
  name_ro: string;
  name_en: string;
}

export interface NewClientOffer {
  percent: number;
  /** Last day of appointments it covers (YYYY-MM-DD, Bucharest); null = no end. */
  until: string | null;
  /** The services it covers; null = all. */
  services: NamedServiceRef[] | null;
}

export interface QuietDayOffer {
  percent: number;
  /** Weekdays, 0 = Sunday … 6 = Saturday. */
  days: number[];
}

export interface ShopOffers {
  newClient: NewClientOffer | null;
  quietDay: QuietDayOffer | null;
}

export const NO_OFFERS: ShopOffers = { newClient: null, quietDay: null };

export const OFFER_CAP = 15;

/** The weekday of a `YYYY-MM-DD` day (the calendar day itself, no time zone involved). */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** The quiet-day percent on that day, or null. */
export function quietPercentOn(offers: ShopOffers, ymd: string): number | null {
  const q = offers.quietDay;
  return q && q.days.includes(weekdayOf(ymd)) ? Math.min(q.percent, OFFER_CAP) : null;
}

/** Whether the new-client offer covers this day and one of these services. */
export function newClientCovers(offer: NewClientOffer, ymd: string | null, serviceIds: readonly string[]): boolean {
  if (offer.until && ymd && ymd > offer.until) return false;
  if (offer.services && serviceIds.length > 0 && !offer.services.some((s) => serviceIds.includes(s.id))) return false;
  return true;
}

export type OfferKind = 'new_client' | 'quiet_day';

/** The offer a booking on that day for those services would get: the larger one, never both. */
export function bestOffer(offers: ShopOffers, ymd: string | null, serviceIds: readonly string[]): { percent: number; kind: OfferKind } | null {
  const nc = offers.newClient && newClientCovers(offers.newClient, ymd, serviceIds) ? Math.min(offers.newClient.percent, OFFER_CAP) : null;
  const qd = ymd ? quietPercentOn(offers, ymd) : null;
  if (nc === null && qd === null) return null;
  return (qd ?? 0) > (nc ?? 0) ? { percent: qd!, kind: 'quiet_day' } : { percent: nc!, kind: 'new_client' };
}

export const hasOffer = (offers: ShopOffers): boolean => offers.newClient !== null || offers.quietDay !== null;
