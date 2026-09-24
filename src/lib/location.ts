import { useEffect, useSyncExternalStore } from 'react';
import type { Coords } from './geo';

/**
 * The client's position for "Aproape de tine" (P16d). Kept in memory for this visit only: never
 * written to the database, to web storage or sent with a search (distances are computed here).
 *
 * The browser's own permission prompt appears only when the client taps "Activează" (`request()`).
 * If the permission was already granted earlier, the position is read on its own — that shows no
 * prompt.
 */
export type LocationStatus =
  /** Not checked yet. */
  | 'unknown'
  /** The browser will ask when we request it. */
  | 'prompt'
  | 'locating'
  | 'granted'
  /** Blocked in the browser settings; only the client can change it there. */
  | 'denied'
  /** The browser has no location at all. */
  | 'unsupported'
  /** Allowed, but the position could not be found (timeout, no signal). */
  | 'error';

export interface LocationState {
  status: LocationStatus;
  coords: Coords | null;
}

let state: LocationState = { status: 'unknown', coords: null };
const listeners = new Set<() => void>();
let started = false;

function set(next: Partial<LocationState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function supported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/** Asks the browser for the position; shows its permission prompt if it has not been answered. */
export function requestLocation(): Promise<LocationStatus> {
  if (!supported()) {
    set({ status: 'unsupported' });
    return Promise.resolve('unsupported');
  }
  set({ status: 'locating' });
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set({ status: 'granted', coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude } });
        resolve('granted');
      },
      (err) => {
        const status: LocationStatus = err.code === err.PERMISSION_DENIED ? 'denied' : 'error';
        set({ status, coords: null });
        resolve(status);
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 },
    );
  });
}

/** Reads the permission state once; reads the position only if it was already granted. */
function start() {
  if (started) return;
  started = true;
  if (!supported()) {
    set({ status: 'unsupported' });
    return;
  }
  if (!navigator.permissions?.query) {
    set({ status: 'prompt' });
    return;
  }
  navigator.permissions.query({ name: 'geolocation' }).then(
    (permission) => {
      const apply = () => {
        if (permission.state === 'granted') {
          if (!state.coords && state.status !== 'locating') void requestLocation();
        } else if (permission.state === 'denied') {
          set({ status: 'denied', coords: null });
        } else if (state.status !== 'locating') {
          set({ status: 'prompt', coords: null });
        }
      };
      apply();
      permission.onchange = apply;
    },
    () => set({ status: 'prompt' }),
  );
}

export function useLocation(): LocationState {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, () => state);
}
