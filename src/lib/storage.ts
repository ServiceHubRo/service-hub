// localStorage can throw (private mode, blocked storage); never let that break the app.
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export const storage = {
  get: (key: string): string | null => safe(() => window.localStorage.getItem(key), null),
  set: (key: string, value: string): void => safe(() => window.localStorage.setItem(key, value), undefined),
  remove: (key: string): void => safe(() => window.localStorage.removeItem(key), undefined),
};
