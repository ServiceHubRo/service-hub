/** Client routes of the search area (T06). */
export const SEARCH_PATH = '/c/cauta';
export const FAVORITES_PATH = '/c/cont/favorite';

export function shopPath(shopId: string): string {
  return `/c/service/${shopId}`;
}

export function bookingPath(shopId: string): string {
  return `/c/service/${shopId}/programare`;
}

/** Router state a link to the shop page carries, so "Înapoi" returns to the exact list. */
export interface ShopLinkState {
  backTo: string;
  backLabel: 'search' | 'favorites';
}
