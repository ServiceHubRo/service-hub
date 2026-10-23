import { useSyncExternalStore } from 'react';

/** "Turul aplicației" in Ajutor și contact asks for the tour again (T39). */
let requested = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function requestTour() {
  requested = true;
  notify();
}

export function clearTourRequest() {
  if (!requested) return;
  requested = false;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTourRequested(): boolean {
  return useSyncExternalStore(subscribe, () => requested);
}

/**
 * Set on a device, the tour and "Primii pași" stay away there (the browser tests, which sign in to
 * many fresh accounts; tests/e2e/onboarding.spec.ts shows them on purpose).
 */
export const ONBOARDING_OFF_KEY = 'sh_onboarding_off';
