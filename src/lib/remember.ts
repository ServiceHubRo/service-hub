import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
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

/** The phone's own storage; on failure, what the web storage gives (`fallback`). */
async function native<T>(fn: () => Promise<T>, fallback: () => T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback();
  }
}

/**
 * In the phone app (T20) a remembered session lives in the phone's own storage (Capacitor
 * Preferences) instead of the app's localStorage. Android writes the WebView's localStorage to disk
 * only seconds after a change, so closing the app from the recent apps soon after Supabase renewed
 * the session lost the new tokens; at the next start the old refresh token, already used, was
 * refused and the user was signed out (Eduard, 15 Oct). Unticked "Ține-mă minte" stays in
 * sessionStorage, as on the web. A session an older version left in localStorage moves over at
 * the first read.
 */
export const nativeAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!rememberMe()) return sessionStore.get(key);
    const legacy = storage.get(key);
    const kept = await native(async () => (await Preferences.get({ key })).value, () => legacy);
    if (kept !== null) return kept;
    if (legacy !== null) {
      await native(() => Preferences.set({ key, value: legacy }).then(() => storage.remove(key)), () => undefined);
    }
    return legacy;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!rememberMe()) {
      sessionStore.set(key, value);
      storage.remove(key);
      await native(() => Preferences.remove({ key }), () => undefined);
      return;
    }
    await native(
      () => Preferences.set({ key, value }).then(() => storage.remove(key)),
      () => storage.set(key, value),
    );
    sessionStore.remove(key);
  },
  async removeItem(key: string): Promise<void> {
    storage.remove(key);
    sessionStore.remove(key);
    await native(() => Preferences.remove({ key }), () => undefined);
  },
};

/** Where the Supabase client keeps the session: the phone's storage in the app, else the web's. */
export const sessionStorageForAuth = Capacitor.isNativePlatform() ? nativeAuthStorage : authStorage;

export function markSeen(now: number = Date.now()): void {
  storage.set(LAST_SEEN_KEY, String(now));
}

/** True when a remembered session has not been used for 30 days on this device. */
export function inactiveTooLong(now: number = Date.now()): boolean {
  const last = Number(storage.get(LAST_SEEN_KEY));
  return Number.isFinite(last) && last > 0 && now - last > INACTIVITY_LIMIT_MS;
}
