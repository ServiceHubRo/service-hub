/** Admin routes (T16a). The five navigation items are in src/app/roles.ts. */
export const ADMIN_OVERVIEW_PATH = '/admin/prezentare';
export const ADMIN_SHOPS_PATH = '/admin/service-uri';
export const ADMIN_CLIENTS_PATH = '/admin/clienti';
export const ADMIN_BOOKINGS_PATH = '/admin/rezervari';
export const ADMIN_MODERATION_PATH = '/admin/moderare';
export const ADMIN_ACCOUNT_PATH = '/admin/cont';
export const ADMIN_AUDIT_PATH = '/admin/cont/jurnal';

export const adminShopPath = (id: string) => `${ADMIN_SHOPS_PATH}/${id}`;
export const adminClientPath = (id: string) => `${ADMIN_CLIENTS_PATH}/${id}`;
export const adminBookingPath = (id: string) => `${ADMIN_BOOKINGS_PATH}/${id}`;
export const adminThreadPath = (id: string) => `/admin/mesaje/${id}`;

/** Rezervări already filtered to one shop or one client. */
export function adminBookingsLink(filter: { shop?: string; client?: string }): string {
  const params = new URLSearchParams();
  if (filter.shop) params.set('service', filter.shop);
  if (filter.client) params.set('client', filter.client);
  const q = params.toString();
  return q ? `${ADMIN_BOOKINGS_PATH}?${q}` : ADMIN_BOOKINGS_PATH;
}
