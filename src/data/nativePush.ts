import { PushNotifications, type PushNotificationSchema, type Token } from '@capacitor/push-notifications';
import { call, failure, RpcError } from './rpc';
import { supabase } from './supabase';

/**
 * Notifications in the phone app (T20b, ARCHITECTURE §9): the same states and actions as Web Push
 * in `push.ts`, through Firebase Cloud Messaging. The phone's token is saved like a browser's
 * subscription (save_native_push_token, a row keyed `fcm:<token>`), so the dispatcher sends to it
 * with everything else. `push.ts` calls these when the code runs inside the app.
 */

/** The Android notification channel (the server names it in every message, `_shared/fcm.ts`). */
export const CHANNEL_ID = 'service-hub';

const TOKEN_KEY = 'sh_fcm_token';
/** Turned off in Cont on this phone (the permission stays; the device is no longer saved). */
const OFF_KEY = 'sh_push_off';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private storage unavailable: the next start registers again.
  }
}

export type NativePermission = 'granted' | 'denied' | 'prompt';

export async function nativePermission(): Promise<NativePermission> {
  const { receive } = await PushNotifications.checkPermissions();
  return receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'prompt';
}

/** On when allowed, not turned off here, and a token was saved once. */
export async function nativeStatus(): Promise<'on' | 'off' | 'prompt' | 'denied'> {
  const permission = await nativePermission();
  if (permission !== 'granted') return permission;
  return read(OFF_KEY) || !read(TOKEN_KEY) ? 'off' : 'on';
}

let channelMade = false;

/** The channel Android lists in the app's notification settings, named after the app. */
async function ensureChannel(): Promise<void> {
  if (channelMade) return;
  await PushNotifications.createChannel({ id: CHANNEL_ID, name: 'Service-Hub', importance: 4, visibility: 1, vibration: true }).catch(
    () => undefined,
  );
  channelMade = true;
}

/** Registers with Firebase and answers this phone's token (the same one until it changes). */
function registerToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const handles: Promise<{ remove: () => Promise<void> }>[] = [];
    const done = (fn: () => void) => {
      clearTimeout(timer);
      handles.forEach((h) => void h.then((x) => x.remove()));
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new RpcError('network'))), 20_000);
    handles.push(PushNotifications.addListener('registration', (t: Token) => done(() => resolve(t.value))));
    handles.push(
      PushNotifications.addListener('registrationError', () => done(() => reject(new RpcError('push_subscription_invalid')))),
    );
    PushNotifications.register().catch(() => done(() => reject(new RpcError('push_subscription_invalid'))));
  });
}

async function saveToken(token: string): Promise<void> {
  await call('save_native_push_token', { p_token: token, p_platform: 'android', p_user_agent: 'Service-Hub Android' });
  write(TOKEN_KEY, token);
}

async function deleteToken(token: string): Promise<void> {
  if (!supabase) throw new RpcError('network');
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', `fcm:${token}`);
  if (error) throw failure(error);
}

/** After a tap on "Activează": Android's prompt (13+), then the token, saved for the signed-in person. */
export async function nativeEnable(): Promise<'on' | 'denied' | 'dismissed'> {
  let permission = await nativePermission();
  if (permission === 'prompt') {
    const { receive } = await PushNotifications.requestPermissions();
    permission = receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'prompt';
  }
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'dismissed';
  await ensureChannel();
  await saveToken(await registerToken());
  write(OFF_KEY, null);
  return 'on';
}

/** "Dezactivează": this phone is no longer saved (other devices keep their notifications). */
export async function nativeDisable(): Promise<void> {
  const token = read(TOKEN_KEY);
  if (token) await deleteToken(token);
  write(OFF_KEY, '1');
}

/**
 * On every start of the signed-in app: the phone belongs to whoever is signed in, with its current
 * token (Firebase changes it now and then). Best effort.
 */
export async function nativeSync(): Promise<void> {
  try {
    if ((await nativePermission()) !== 'granted' || read(OFF_KEY)) return;
    await ensureChannel();
    const old = read(TOKEN_KEY);
    const token = await registerToken();
    await saveToken(token);
    if (old && old !== token) await deleteToken(old).catch(() => undefined);
  } catch {
    // Offline or signing out: the next start tries again.
  }
}

/** Before signing out: the leaving person's notifications stop on this phone. Best effort, ~2 s. */
export async function nativeForget(): Promise<void> {
  const token = read(TOKEN_KEY);
  if (!token || !supabase) return;
  await Promise.race([deleteToken(token).catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 2500))]);
}

/** The app path of a tapped notification (the server puts it in `data.url`). */
export function onNotificationTap(open: (url: unknown) => void): () => void {
  const handle = PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const data = (action.notification as PushNotificationSchema).data as { url?: unknown } | undefined;
    open(data?.url);
  });
  return () => void handle.then((h) => h.remove());
}
