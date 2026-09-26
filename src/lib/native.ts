import { Capacitor } from '@capacitor/core';

/**
 * The phone apps (T20): the same code runs on the web and inside the Android / iPhone app
 * (Capacitor), where the page's own address is https://localhost — fine for the app itself, not
 * for links that leave it.
 */
export const IS_NATIVE = Capacitor.isNativePlatform();

/** The app's link scheme: ro.servicehub.app://app/… opens the installed app (email links). */
export const APP_SCHEME = 'ro.servicehub.app';
export const APP_LINK_ORIGIN = `${APP_SCHEME}://app`;

/** The published site, for links other people open from the app (a staff invitation). */
export const WEB_URL = (import.meta.env.VITE_WEB_URL || 'https://service-hubapp.netlify.app').replace(/\/+$/, '');

/** The site's address for links opened by someone else: this page's on the web, the site's in the app. */
export function webOrigin(): string {
  return IS_NATIVE ? WEB_URL : window.location.origin;
}

/** Where email links (confirmation, password, email change) land: this site, or the app itself. */
export function emailLinkOrigin(): string {
  return IS_NATIVE ? APP_LINK_ORIGIN : window.location.origin;
}

/**
 * An app link opened from an email, split into the screen to show and the answer Supabase Auth
 * put after `#` (tokens or an error): `ro.servicehub.app://app/parola-noua#access_token=…`.
 */
export function parseAppLink(url: string): { path: string; params: URLSearchParams } | null {
  if (!url.startsWith(`${APP_LINK_ORIGIN}/`) && url !== APP_LINK_ORIGIN) return null;
  const rest = url.slice(APP_LINK_ORIGIN.length) || '/';
  const hashAt = rest.indexOf('#');
  const pathAndQuery = hashAt === -1 ? rest : rest.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : rest.slice(hashAt + 1);
  const path = pathAndQuery.split('?')[0] || '/';
  return { path: path.startsWith('/') ? path : `/${path}`, params: new URLSearchParams(hash) };
}
