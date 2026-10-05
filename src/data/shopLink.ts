import { call } from './rpc';
import { storage } from '../lib/storage';

/**
 * The shop's own link (T31b): `/atelier/<shop id>`, which the shop sends its clients itself (from
 * its phone, WhatsApp) or prints as a QR code. Anyone can open it; a client lands on the shop's
 * page, a visitor first makes an account or signs in.
 */
export interface ShopLinkPreview {
  id: string;
  name: string;
  city: string;
  street: string | null;
  logo_url: string | null;
  rating: number | null;
  review_count: number;
}

export async function shopLinkPreview(shopId: string): Promise<ShopLinkPreview | null> {
  const data = (await call('shop_link_preview', { p_shop_id: shopId })) as unknown as ShopLinkPreview | null;
  return data && { ...data, rating: data.rating === null ? null : Number(data.rating) };
}

export function shopLinkPath(shopId: string): string {
  return `/atelier/${shopId}`;
}

/** The full address to share, on the site the app runs on. */
export function shopLinkUrl(shopId: string): string {
  return `${window.location.origin}${shopLinkPath(shopId)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isShopId(value: string | undefined): value is string {
  return !!value && UUID_RE.test(value);
}

// A visitor who opened the link and then made an account (possibly confirming the email in another
// tab) is taken to the shop's page once.
const PENDING_KEY = 'sh.shop';

export function rememberShop(shopId: string): void {
  storage.set(PENDING_KEY, shopId);
}

export function pendingShop(): string | null {
  const value = storage.get(PENDING_KEY) ?? undefined;
  return isShopId(value) ? value : null;
}

export function forgetShop(): void {
  storage.remove(PENDING_KEY);
}
