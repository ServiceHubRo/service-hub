import { useLocation } from 'react-router-dom';
import { useI18n } from '../../../i18n/context';
import { shopPath, type ShopLinkState } from '../paths';

/**
 * Where „‹ Înapoi” leads from a screen of a shop (its reviews, its services): from the search (the
 * shop was shown beside the results) or from the favorites, back there; from the shop's own page, to it.
 */
export function useShopBack(shopId: string, shopName: string | undefined): { to: string; label: string } {
  const { t } = useI18n();
  const from = useLocation().state as ShopLinkState | null;
  if (from?.backTo) return { to: from.backTo, label: from.backLabel === 'favorites' ? t('favorites.title') : t('shop.allShops') };
  return { to: shopPath(shopId), label: shopName ?? t('shop.allShops') };
}
