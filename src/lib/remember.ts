import { sessionStore, storage } from './storage';

/**
 * "Ține-mă minte" (ARCHITECTURE §15). Chosen per device on the sign-in form and stored here,
 * never on the profile. Ticked (default): the session lives in localStorage and survives closing
 * the browser. Unticked: sessionStorage, so it ends when the browser closes.
 */
export const REMEMBER_KEY = 'sh_remember';

/** When the app was last used on this device; after 30 days without use the session ends. */
export const LAST_SEEN_KEY = 'sh_last_seen';
export const INACTIVITY_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;

export function rememberMe(): boolean {
  return storage.get(REMEMBER_KEY) !== '0';
}

export function setRememberMe(remember: boolean): void {
  storage.set(REMEMBER_KEY, remember ? '1' : '0');
}

/** Storage adapter for supabase-js: the session goes where "Ține-mă minte" says. */
export const authStorage = {
  getItem(key: string): string | null {
    return rememberMe() ? storage.get(key) : sessionStore.get(key);
  },
  setItem(key: string, value: string): void {
    if (rememberMe()) {
      storage.set(key, value);
      sessionStore.remove(key);
    } else {
      sessionStore.set(key, value);
      storage.remove(key);
    }
  },
  removeItem(key: string): void {
    storage.remove(key);
    sessionStore.remove(key);
  },
};

export function markSeen(now: number = Date.now()): void {
  storage.set(LAST_SEEN_KEY, String(now));
}

/** True when a remembered session has not been used for 30 days on this device. */
export function inactiveTooLong(now: number = Date.now()): boolean {
  const last = Number(storage.get(LAST_SEEN_KEY));
  return Number.isFinite(last) && last > 0 && now - last > INACTIVITY_LIMIT_MS;
}
