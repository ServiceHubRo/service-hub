import { useSyncExternalStore } from 'react';
import { storage } from './storage';

/**
 * The sound of a new booking (T47): a short, soft chime the shop hears in the open app when a
 * request arrives (ShopBookingsProvider). The same file rings the phone app's notifications for new
 * bookings (res/raw/new_booking.wav, nativePush.ts). Both are made by scripts/gen-chime.mjs.
 * On by default, turned off per device in the shop's Cont, under push.
 */
export const CHIME_URL = '/sounds/new-booking.wav';

const OFF_KEY = 'sh_sound_off';
/** Several requests in a moment ring once. */
const QUIET_MS = 2000;

const listeners = new Set<() => void>();
let ctx: AudioContext | null = null;
let buffer: Promise<AudioBuffer | null> | null = null;
let lastPlayed = 0;

export function chimeOn(): boolean {
  return storage.get(OFF_KEY) !== '1';
}

export function setChimeOn(on: boolean): void {
  if (on) storage.remove(OFF_KEY);
  else storage.set(OFF_KEY, '1');
  listeners.forEach((l) => l());
  tellWorker();
}

/**
 * Tells the service worker whether this page can ring the chime now (sound on, and the browser lets
 * it play): a new booking's push then shows silently instead of sounding twice (public/sw.js).
 */
function tellWorker(ready = chimeOn() && ctx?.state === 'running'): void {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'sh:chime', ready });
  } catch {
    // No worker: the notification keeps its own sound.
  }
}

export function useChimeOn(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    chimeOn,
    () => true,
  );
}

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  try {
    ctx = new Context();
  } catch {
    return null;
  }
  return ctx;
}

function sound(c: AudioContext): Promise<AudioBuffer | null> {
  buffer ??= fetch(CHIME_URL)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((data) => c.decodeAudioData(data))
    .catch(() => {
      buffer = null; // try again next time
      return null;
    });
  return buffer;
}

/**
 * Browsers let a page make sound only after the person has touched it: the first touch or key
 * wakes the sound up (and fetches the file), so the next request can ring. Returns the cleanup.
 */
export function primeChime(): () => void {
  const wake = () => {
    const c = audio();
    if (!c) return;
    void c.resume().then(() => tellWorker(), () => undefined);
    void sound(c);
  };
  const events = ['pointerdown', 'keydown'] as const;
  events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
  // A worker that slept has forgotten: say it again when the page comes back on screen.
  const again = () => {
    if (document.visibilityState === 'visible') tellWorker();
  };
  document.addEventListener('visibilitychange', again);
  return () => {
    events.forEach((e) => window.removeEventListener(e, wake));
    document.removeEventListener('visibilitychange', again);
    // The shop's screens are closed (signed out): this page no longer rings.
    tellWorker(false);
  };
}

/** Rings once, if this device has the sound on (`force`: the "Ascultă" button plays it anyway). */
export async function playChime(force = false): Promise<boolean> {
  if (!force && !chimeOn()) return false;
  const now = Date.now();
  if (!force && now - lastPlayed < QUIET_MS) return false;
  const c = audio();
  if (!c) return false;
  if (c.state !== 'running') await c.resume().catch(() => undefined);
  if (c.state !== 'running') return false;
  const b = await sound(c);
  if (!b) return false;
  lastPlayed = now;
  const source = c.createBufferSource();
  source.buffer = b;
  source.connect(c.destination);
  source.start();
  return true;
}
