import { afterEach, describe, expect, it, vi } from 'vitest';

// The phone's own storage (Capacitor Preferences), in memory; `failing` makes every call throw.
const prefs = vi.hoisted(() => ({ data: new Map<string, string>(), failing: false }));
vi.mock('@capacitor/preferences', () => {
  const check = () => {
    if (prefs.failing) throw new Error('plugin not available');
  };
  return {
    Preferences: {
      get: async ({ key }: { key: string }) => (check(), { value: prefs.data.get(key) ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => {
        check();
        prefs.data.set(key, value);
      },
      remove: async ({ key }: { key: string }) => {
        check();
        prefs.data.delete(key);
      },
    },
  };
});

import { nativeAuthStorage, setRememberMe } from '../../src/lib/remember';

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  prefs.data.clear();
  prefs.failing = false;
});

describe('the session in the phone app (Eduard, 15 Oct: signed out after closing the app)', () => {
  it('ticked: kept in the phone storage, not in localStorage', async () => {
    setRememberMe(true);
    await nativeAuthStorage.setItem('sb-token', 'abc');
    expect(prefs.data.get('sb-token')).toBe('abc');
    expect(localStorage.getItem('sb-token')).toBeNull();
    expect(sessionStorage.getItem('sb-token')).toBeNull();
    expect(await nativeAuthStorage.getItem('sb-token')).toBe('abc');
    await nativeAuthStorage.removeItem('sb-token');
    expect(prefs.data.has('sb-token')).toBe(false);
    expect(await nativeAuthStorage.getItem('sb-token')).toBeNull();
  });

  it('a session left in localStorage by an older version moves over at the first read', async () => {
    setRememberMe(true);
    localStorage.setItem('sb-token', 'old');
    expect(await nativeAuthStorage.getItem('sb-token')).toBe('old');
    expect(prefs.data.get('sb-token')).toBe('old');
    expect(localStorage.getItem('sb-token')).toBeNull();
  });

  it('unticked: in sessionStorage only, as on the web', async () => {
    prefs.data.set('sb-token', 'before');
    setRememberMe(false);
    await nativeAuthStorage.setItem('sb-token', 'abc');
    expect(sessionStorage.getItem('sb-token')).toBe('abc');
    expect(prefs.data.has('sb-token')).toBe(false);
    expect(await nativeAuthStorage.getItem('sb-token')).toBe('abc');
  });

  it('without the phone storage, localStorage keeps the session', async () => {
    prefs.failing = true;
    setRememberMe(true);
    await nativeAuthStorage.setItem('sb-token', 'abc');
    expect(localStorage.getItem('sb-token')).toBe('abc');
    expect(await nativeAuthStorage.getItem('sb-token')).toBe('abc');
  });
});
