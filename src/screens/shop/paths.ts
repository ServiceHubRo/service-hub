import type { ShopFilter, ShopTab } from '../../lib/shopBookings';

/** Programări of the shop (T08). The tab, a Panou filter or one booking live in the address. */
export const SHOP_BOOKINGS_PATH = '/s/programari';

export function shopBookingsLink(options: { tab?: ShopTab; filter?: ShopFilter; booking?: string } = {}): string {
  const params = new URLSearchParams();
  if (options.tab) params.set('tab', options.tab);
  if (options.filter) params.set('filtru', options.filter);
  if (options.booking) params.set('p', options.booking);
  const query = params.toString();
  return query ? `${SHOP_BOOKINGS_PATH}?${query}` : SHOP_BOOKINGS_PATH;
}

/** Cont of the shop and the Recenzii tile inside it (T11). */
export const ACCOUNT_PATH = '/s/cont';
export const REVIEWS_PATH = '/s/cont/recenzii';

/** Abonament, the owner's tile in Cont (T14). Every subscription notice and email leads here. */
export const SUBSCRIPTION_PATH = '/s/cont/abonament';

/** Rapoarte, the owner's tile in Cont (T17): the period lives in the address (`?perioada=`). */
export const REPORTS_PATH = '/s/cont/rapoarte';
