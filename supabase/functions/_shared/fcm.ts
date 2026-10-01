// Notifications to the phone app through Firebase Cloud Messaging (T20b, ARCHITECTURE §9): the
// HTTP v1 API with an OAuth token made from the Firebase service account (the FCM_SERVICE_ACCOUNT
// secret, the JSON key Firebase gives). Plain fetch and WebCrypto, no npm package, no Deno here:
// the unit tests run it against a fake Google.
import { toBase64Url } from './webpush.ts';

export interface FcmServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

export interface FcmConfig {
  account: FcmServiceAccount | null;
  fetch?: typeof fetch;
  /** Google's addresses, only for tests. */
  apiUrl?: string;
}

/** The service account from the secret's JSON; null when missing or not a service account key. */
export function parseServiceAccount(json: string | undefined | null): FcmServiceAccount | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
    const projectId = str(o.project_id);
    const clientEmail = str(o.client_email);
    const privateKey = str(o.private_key);
    if (!projectId || !clientEmail || !privateKey?.includes('PRIVATE KEY')) return null;
    return { projectId, clientEmail, privateKey, tokenUri: str(o.token_uri) ?? 'https://oauth2.googleapis.com/token' };
  } catch {
    return null;
  }
}

function pemToBytes(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const text = (s: string) => new TextEncoder().encode(s);

/** The signed assertion Google exchanges for an access token (RS256, valid one hour). */
export async function serviceAccountJwt(account: FcmServiceAccount, now: number = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  const header = toBase64Url(text(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = toBase64Url(
    text(
      JSON.stringify({
        iss: account.clientEmail,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: account.tokenUri,
        iat,
        exp: iat + 3600,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(account.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, text(`${header}.${claims}`)));
  return `${header}.${claims}.${toBase64Url(signature)}`;
}

let cached: { email: string; token: string; until: number } | null = null;

/** An access token for FCM, kept until five minutes before it expires. */
export async function accessToken(config: FcmConfig, now: number = Date.now()): Promise<string> {
  const account = config.account!;
  if (cached && cached.email === account.clientEmail && cached.until > now) return cached.token;
  const res = await (config.fetch ?? fetch)(account.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await serviceAccountJwt(account, now),
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`fcm auth ${res.status}: ${data.error ?? 'no token'}`);
  cached = { email: account.clientEmail, token: data.access_token, until: now + ((data.expires_in ?? 3600) - 300) * 1000 };
  return data.access_token;
}

/** Forgets the cached token (tests; a 401 from FCM). */
export function resetFcmToken(): void {
  cached = null;
}

export interface FcmMessage {
  title: string;
  body: string;
  /** The app path a tap opens. */
  url: string;
  /** Notifications with the same tag replace each other on the phone. */
  tag: string;
  urgent: boolean;
  ttlSeconds: number;
}

/** The Android notification channel the app creates at start (MainActivity / nativePush.ts). */
export const FCM_CHANNEL_ID = 'service-hub';

/** The request body for one device. */
export function fcmBody(token: string, m: FcmMessage): Record<string, unknown> {
  return {
    message: {
      token,
      notification: { title: m.title, body: m.body },
      data: { url: m.url, tag: m.tag },
      android: {
        priority: m.urgent ? 'HIGH' : 'NORMAL',
        ttl: `${m.ttlSeconds}s`,
        collapse_key: m.tag.slice(0, 100),
        notification: { channel_id: FCM_CHANNEL_ID, tag: m.tag, default_sound: true },
      },
    },
  };
}

export type FcmOutcome = { outcome: 'sent' | 'gone' | 'retry' | 'failed'; error?: string };

/**
 * Sends one notification to one device. A token the phone no longer has (the app was removed or
 * its data cleared) answers `gone`, and the dispatcher deletes it; Google busy or unreachable
 * answers `retry`.
 */
export async function sendFcm(config: FcmConfig, token: string, m: FcmMessage): Promise<FcmOutcome> {
  if (!config.account) return { outcome: 'failed', error: 'fcm_not_configured' };
  const base = (config.apiUrl ?? 'https://fcm.googleapis.com').replace(/\/+$/, '');
  let res: Response;
  try {
    res = await (config.fetch ?? fetch)(`${base}/v1/projects/${config.account.projectId}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken(config)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fcmBody(token, m)),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { outcome: 'retry', error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
  if (res.ok) return { outcome: 'sent' };
  const data = (await res.json().catch(() => ({}))) as {
    error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
  };
  const code = data.error?.details?.find((d) => d.errorCode)?.errorCode ?? data.error?.status ?? '';
  const error = `fcm ${res.status} ${code}`.trim().slice(0, 300);
  if (res.status === 404 || code === 'UNREGISTERED' || (res.status === 400 && /registration token/i.test(data.error?.message ?? ''))) {
    return { outcome: 'gone', error };
  }
  if (res.status === 401) resetFcmToken();
  if (res.status === 401 || res.status === 429 || res.status >= 500) return { outcome: 'retry', error };
  return { outcome: 'failed', error };
}
