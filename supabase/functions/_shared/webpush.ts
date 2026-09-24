// Web Push without npm packages: VAPID (RFC 8292) and message encryption (RFC 8291, aes128gcm),
// with WebCrypto only. Runs the same in Deno (Edge Functions) and Node (the unit tests).

type Bytes = Uint8Array<ArrayBuffer>;

// ------------------------------------------------------------------------------------------------
// base64url
// ------------------------------------------------------------------------------------------------
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Bytes {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const utf8 = (text: string): Bytes => new TextEncoder().encode(text) as Bytes;

// ------------------------------------------------------------------------------------------------
// VAPID keys and the Authorization header
// ------------------------------------------------------------------------------------------------
export interface VapidKeys {
  /** Uncompressed P-256 point (65 bytes), base64url — the browser's applicationServerKey. */
  publicKey: string;
  /** The private key as a JWK (kept by the server only). */
  privateJwk: JsonWebKey;
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: toBase64Url(raw), privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } };
}

/**
 * `vapid t=<JWT>, k=<public key>` for one push service: the JWT is signed with ES256 for the
 * endpoint's origin and is valid 12 hours (push services refuse more than 24).
 */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now: number = Date.now(),
): Promise<string> {
  const header = toBase64Url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = toBase64Url(
    utf8(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })),
  );
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${header}.${claims}`)),
  );
  return `vapid t=${header}.${claims}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

// ------------------------------------------------------------------------------------------------
// Message encryption (RFC 8291 + RFC 8188, one record)
// ------------------------------------------------------------------------------------------------
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm as Bytes, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as Bytes, info: info as Bytes },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

const RECORD_SIZE = 4096;

export interface EncryptOptions {
  /** Test hooks: a fixed salt and sender key pair instead of fresh random ones. */
  salt?: Uint8Array;
  senderKeys?: CryptoKeyPair;
}

/**
 * Encrypts a payload for one browser subscription (`keys.p256dh`, `keys.auth`). The answer is the
 * request body for `Content-Encoding: aes128gcm`.
 */
export async function encryptPayload(
  payload: Uint8Array,
  p256dh: string,
  auth: string,
  options: EncryptOptions = {},
): Promise<Bytes> {
  const uaPublic = fromBase64Url(p256dh);
  const authSecret = fromBase64Url(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('invalid_subscription_keys');
  if (payload.length > RECORD_SIZE - 17) throw new Error('payload_too_large');

  const sender =
    options.senderKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256),
  );

  const ikm = await hkdf(authSecret, shared, concat(utf8('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = (options.salt as Bytes | undefined) ?? (crypto.getRandomValues(new Uint8Array(16)) as Bytes);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record: the payload, then the 0x02 delimiter of the last record (no padding).
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(payload, new Uint8Array([2]))),
  );

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

// ------------------------------------------------------------------------------------------------
// Sending
// ------------------------------------------------------------------------------------------------
export interface PushDevice {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type SendOutcome =
  /** The push service took it. */
  | 'sent'
  /** The subscription no longer exists (404 / 410): delete the device. */
  | 'gone'
  /** Worth trying again later (429, 5xx, network). */
  | 'retry'
  /** Refused for good (bad keys, payload too large, VAPID refused). */
  | 'failed';

export interface SendResult {
  outcome: SendOutcome;
  status: number | null;
  error?: string;
}

export interface SendOptions {
  /** Seconds the push service keeps the message for an offline device. */
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  fetch?: typeof fetch;
}

export function outcomeOf(status: number): SendOutcome {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 404 || status === 410) return 'gone';
  if (status === 429 || status >= 500) return 'retry';
  return 'failed';
}

export async function sendWebPush(
  device: PushDevice,
  payload: string,
  vapid: VapidKeys,
  subject: string,
  options: SendOptions = {},
): Promise<SendResult> {
  let body: Bytes;
  try {
    body = await encryptPayload(utf8(payload), device.keys.p256dh, device.keys.auth);
  } catch (e) {
    return { outcome: 'failed', status: null, error: e instanceof Error ? e.message : 'encrypt_failed' };
  }
  try {
    const res = await (options.fetch ?? fetch)(device.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(device.endpoint, vapid, subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(options.ttl ?? 86400),
        Urgency: options.urgency ?? 'normal',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const outcome = outcomeOf(res.status);
    const error = outcome === 'sent' ? undefined : `${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`.trim();
    if (outcome === 'sent') await res.body?.cancel();
    return { outcome, status: res.status, error };
  } catch (e) {
    return { outcome: 'retry', status: null, error: e instanceof Error ? e.message : 'network' };
  }
}
