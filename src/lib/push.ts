/**
 * What this browser can do with Web Push (T12, P15b). Pure browser checks — the subscription and
 * the database side live in `src/data/push.ts`.
 */

/** Service worker + Push API + Notification API: everything Web Push needs. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    window.isSecureContext
  );
}

/** iPhone or iPad (iPadOS reports itself as a Mac with touch). */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Opened from the Home Screen icon (installed web app), not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/**
 * On iPhone, Web Push works only in the app added to the Home Screen (iOS 16.4+), never in a
 * Safari tab — there the app explains how to add it instead of offering a button that fails.
 */
export function needsHomeScreen(): boolean {
  return isIos() && !isStandalone();
}

/** The VAPID public key (base64url) as the bytes `pushManager.subscribe()` expects. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Whether a subscription was made with this key (after a key change it must be made again). */
export function sameKey(current: ArrayBuffer | null | undefined, base64url: string): boolean {
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = keyBytes(base64url);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** A path inside the app from a notification tap; anything else is ignored. */
export function appPath(url: unknown): string | null {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : null;
}

export const SERVICE_WORKER_URL = '/sw.js';
