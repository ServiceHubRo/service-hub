import { useOutletContext } from 'react-router-dom';
import type { Shop } from '../../../data/shop';

export interface ShopSettingsContext {
  shop: Shop;
  /** Replaces the shop after a save (screens stay where they are). */
  setShop: (shop: Shop) => void;
  /** Billing, staff (and later subscription) are the owner's only. */
  isOwner: boolean;
}

/** The shop loaded by ShopSettingsLayout, for every settings section. */
export function useShopSettings(): ShopSettingsContext {
  return useOutletContext<ShopSettingsContext>();
}
