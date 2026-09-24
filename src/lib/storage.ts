// Web storage can throw (private mode, blocked storage); never let that break the app.
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function wrap(pick: () => Storage) {
  return {
    get: (key: string): string | null => safe(() => pick().getItem(key), null),
    set: (key: string, value: string): void => safe(() => pick().setItem(key, value), undefined),
    remove: (key: string): void => safe(() => pick().removeItem(key), undefined),
  };
}

/** localStorage: survives closing the browser. */
export const storage = wrap(() => window.localStorage);

/** sessionStorage: gone when the browser (tab) closes. */
export const sessionStore = wrap(() => window.sessionStorage);
