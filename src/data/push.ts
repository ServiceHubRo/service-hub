import { FunctionsFetchError } from '@supabase/supabase-js';
import { useEffect, useSyncExternalStore } from 'react';
import { keyBytes, needsHomeScreen, pushSupported, sameKey, SERVICE_WORKER_URL } from '../lib/push';
import { call, failure, RpcError } from './rpc';
import { supabase } from './supabase';

/**
 * Push notifications on this device (T12, P15b, ARCHITECTURE §9): the state for the banner and
 * the Cont row, turning them on (the browser's own prompt appears only then, after a tap) and off,
 * and keeping the device linked to whoever is signed in on it.
 */
export type PushStatus =
  /** Not checked yet. */
  | 'unknown'
  /** No Web Push in this browser. */
  | 'unsupported'
  /** iPhone/iPad in a Safari tab: works only from the app added to the Home Screen. */
  | 'ios_install'
  /** Never answered: the browser asks when we request it. */
  | 'prompt'
  /** Allowed, but not on for this device (turned off here). */
  | 'off'
  | 'on'
  /** Blocked in the browser settings; only the person can change it there. */
  | 'denied'
  /** Turning on or off right now. */
  | 'working';

let status: PushStatus = 'unknown';
const listeners = new Set<() => void>();
let started = false;

function set(next: PushStatus) {
  if (next === status) return;
  status = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Reads the browser's permission and this device's subscription. */
export async function refreshPush(): Promise<PushStatus> {
  if (needsHomeScreen()) {
    set('ios_install');
  } else if (!pushSupported()) {
    set('unsupported');
  } else if (Notification.permission === 'denied') {
    set('denied');
  } else if (Notification.permission === 'default') {
    set('prompt');
  } else {
    try {
      set((await currentSubscription()) ? 'on' : 'off');
    } catch {
      set('off');
    }
  }
  return status;
}

function start() {
  if (started) return;
  started = true;
  void refreshPush();
  // The permission can change in the browser settings while the app is open.
  navigator.permissions?.query({ name: 'notifications' as PermissionName }).then(
    (permission) => {
      permission.onchange = () => void refreshPush();
    },
    () => undefined,
  );
}

export function usePushStatus(): PushStatus {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, () => status);
}

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

/** The server's VAPID public key (made by the dispatcher on first use). */
async function fetchPublicKey(): Promise<string> {
  const { data, error } = await db().functions.invoke<{ publicKey?: string }>('dispatch-notifications', { method: 'GET' });
  if (error) throw error instanceof FunctionsFetchError ? new RpcError('network') : new RpcError('unknown');
  if (!data?.publicKey) throw new RpcError('unknown');
  return data.publicKey;
}

async function saveDevice(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  await call('save_push_subscription', {
    p_endpoint: subscription.endpoint,
    p_subscription: { endpoint: subscription.endpoint, expirationTime: json.expirationTime ?? null, keys: json.keys ?? {} },
    p_user_agent: navigator.userAgent.slice(0, 500),
  });
}

async function deleteDevice(endpoint: string): Promise<void> {
  const { error } = await db().from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw failure(error);
}

export type EnableOutcome = 'on' | 'denied' | 'dismissed';

/**
 * After a tap on "Activează": the browser's permission prompt, then the subscription, saved for the
 * signed-in person. Network or save failures are thrown (the button shows them with a retry).
 */
export async function enablePush(): Promise<EnableOutcome> {
  if (!pushSupported()) {
    await refreshPush();
    return 'dismissed';
  }
  // First, while the tap still counts as the user's gesture (Safari requires it).
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission === 'denied') {
    set('denied');
    return 'denied';
  }
  if (permission !== 'granted') {
    set('prompt');
    return 'dismissed';
  }
  set('working');
  try {
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);
    await navigator.serviceWorker.ready;
    const key = await fetchPublicKey();
    let sub = await registration.pushManager.getSubscription();
    if (sub && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    await saveDevice(sub);
    set('on');
    return 'on';
  } catch (e) {
    await refreshPush();
    // The browser or its push service refused the subscription (offline, blocked by an extension…).
    throw e instanceof RpcError ? e : new RpcError('push_subscription_invalid');
  }
}

/** "Dezactivează" in Cont: this device stops getting notifications (other devices keep them). */
export async function disablePush(): Promise<void> {
  set('working');
  try {
    const sub = await currentSubscription();
    if (sub) {
      await deleteDevice(sub.endpoint);
      await sub.unsubscribe();
    }
    set('off');
  } catch (e) {
    await refreshPush();
    throw e instanceof RpcError ? e : new RpcError('unknown');
  }
}

/**
 * On every start of the signed-in app: if this device has a subscription, it belongs to whoever is
 * signed in now (the same browser may have been used by another account). Best effort.
 */
export async function syncPushDevice(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    // Also picks up a newer service worker after a deploy.
    await navigator.serviceWorker.register(SERVICE_WORKER_URL);
    const sub = await currentSubscription();
    if (sub) await saveDevice(sub);
  } catch {
    // Offline or the session is ending: the next start tries again.
  }
}

/**
 * Before signing out: this device stops getting the leaving person's notifications. The browser
 * keeps its subscription, so the next person to sign in here (with the permission already given)
 * gets theirs. Best effort, at most a couple of seconds.
 */
export async function forgetPushDevice(): Promise<void> {
  if (!pushSupported() || !supabase) return;
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await Promise.race([deleteDevice(sub.endpoint), new Promise((resolve) => setTimeout(resolve, 2500))]);
  } catch {
    // The next account to sign in here claims the device anyway (save_push_subscription).
  }
}

/** "Nu acum" on the banner, saved on the profile (column grant). */
export async function dismissPushPrompt(profileId: string): Promise<void> {
  const { error } = await db()
    .from('profiles')
    .update({ push_prompt_dismissed_at: new Date().toISOString() })
    .eq('id', profileId);
  if (error) throw failure(error);
}
