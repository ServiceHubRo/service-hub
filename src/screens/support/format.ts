import type { SupportAccount } from '../../data/support';
import type { MessageKey } from '../../i18n/ro';

/** "Atelier Unu · Brașov · proprietar" */
export function shopLine(t: (key: MessageKey) => string, shop: NonNullable<SupportAccount['shop']>): string {
  return [shop.name, shop.city, t(shop.staff_role === 'owner' ? 'support.account.shopOwner' : 'support.account.shopStaff')]
    .filter(Boolean)
    .join(' · ');
}
