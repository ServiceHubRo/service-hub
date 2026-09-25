import { lazy, type ComponentType } from 'react';
import { sessionStore } from '../../lib/storage';

const RELOADED_KEY = 'sh_chunk_reload';

/**
 * `React.lazy` for a part of the app loaded on demand (T18: each role's code is its own file).
 * After a new deploy the old files are gone, so an open tab cannot load them: reload the page once
 * to get the new version. A second failure in a row (offline, server down, or storage blocked so
 * the reload cannot be remembered) reaches the error screen of `ChunkBoundary` instead.
 */
export function lazyChunk<T extends ComponentType<object>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await load();
      sessionStore.remove(RELOADED_KEY);
      return mod;
    } catch (error) {
      if (navigator.onLine && sessionStore.get(RELOADED_KEY) !== '1') {
        sessionStore.set(RELOADED_KEY, '1');
        if (sessionStore.get(RELOADED_KEY) === '1') {
          window.location.reload();
          // Keep the loading screen up while the page reloads.
          return new Promise<{ default: T }>(() => {});
        }
      }
      throw error;
    }
  });
}
