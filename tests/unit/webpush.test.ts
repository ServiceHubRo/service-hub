import { describe, expect, it } from 'vitest';
import {
  encryptPayload,
  fromBase64Url,
  generateVapidKeys,
  outcomeOf,
  sendWebPush,
  toBase64Url,
  vapidAuthorization,
} from '../../supabase/functions/_shared/webpush.ts';

type Bytes = Uint8Array<ArrayBuffer>;
const utf8 = (s: string) => new TextEncoder().encode(s) as Bytes;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm as Bytes, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as Bytes, info: info as Bytes }, key, length * 8),
  );
}

/** The browser's side of RFC 8291: decrypts what encryptPayload produced. */
async function decrypt(body: Uint8Array, receiver: CryptoKeyPair, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idLen = body[20]!;
  const asPublic = body.slice(21, 21 + idLen);
  const cipher = body.slice(21 + idLen);
  expect(rs).toBe(4096);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey));
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, receiver.privateKey, 256));
  const info = new Uint8Array([...utf8('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  expect(plain[plain.length - 1]).toBe(2); // last-record delimiter
  return new TextDecoder().decode(plain.slice(0, -1));
}

/** An ECDH key pair from the raw public point and the private scalar (RFC 8291 test keys). */
async function importPair(publicB64: string, privateB64: string): Promise<CryptoKeyPair> {
  const raw = fromBase64Url(publicB64);
  const jwk = { kty: 'EC', crv: 'P-256', x: toBase64Url(raw.slice(1, 33)), y: toBase64Url(raw.slice(33, 65)) };
  const alg = { name: 'ECDH', namedCurve: 'P-256' };
  return {
    publicKey: await crypto.subtle.importKey('jwk', jwk, alg, true, []),
    privateKey: await crypto.subtle.importKey('jwk', { ...jwk, d: privateB64 }, alg, true, ['deriveBits']),
  };
}

describe('Web Push encryption (RFC 8291)', () => {
  it('matches the example in RFC 8291 Appendix A', async () => {
    const sender = await importPair(
      'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
      'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    );
    const body = await encryptPayload(
      utf8('When I grow up, I want to be a watermelon'),
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      'BTBZMqHH6r4Tts7J_aSIgg',
      { salt: fromBase64Url('DGv6ra1nlYgDCS1FRnbzlw'), senderKeys: sender },
    );
    expect(toBase64Url(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('the browser can decrypt what the server sends, with Romanian letters intact', async () => {
    const receiver = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const message = JSON.stringify({ title: 'Atelier Unu', body: 'Devizul pentru mașina ta e gata: 1.250 lei.' });
    const body = await encryptPayload(utf8(message), toBase64Url(uaPublic), toBase64Url(auth));
    expect(await decrypt(body, receiver, auth)).toBe(message);
  });

  it('refuses bad keys and oversized payloads', async () => {
    await expect(encryptPayload(utf8('x'), 'AAAA', 'BTBZMqHH6r4Tts7J_aSIgg')).rejects.toThrow('invalid_subscription_keys');
    const receiver = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const uaPublic = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey)));
    await expect(encryptPayload(new Uint8Array(5000), uaPublic, 'BTBZMqHH6r4Tts7J_aSIgg')).rejects.toThrow('payload_too_large');
  });
});

describe('VAPID', () => {
  it('makes a P-256 key pair and signs a JWT for the push service origin', async () => {
    const keys = await generateVapidKeys();
    expect(fromBase64Url(keys.publicKey)).toHaveLength(65);
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'https://service-hub.ro', 1_800_000_000_000);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, h, c, s, k] = match!;
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(h!)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(c!)))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1_800_000_000 + 12 * 3600,
      sub: 'https://service-hub.ro',
    });
    const publicKey = await crypto.subtle.importKey('raw', fromBase64Url(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, fromBase64Url(s!), utf8(`${h}.${c}`));
    expect(valid).toBe(true);
  });
});

describe('sending', () => {
  it('maps push service answers', () => {
    expect(outcomeOf(201)).toBe('sent');
    expect(outcomeOf(404)).toBe('gone');
    expect(outcomeOf(410)).toBe('gone');
    expect(outcomeOf(429)).toBe('retry');
    expect(outcomeOf(503)).toBe('retry');
    expect(outcomeOf(413)).toBe('failed');
    expect(outcomeOf(403)).toBe('failed');
  });

  it('posts an encrypted body with the Web Push headers', async () => {
    const keys = await generateVapidKeys();
    const receiver = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const device = {
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/abc',
      keys: { p256dh: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey))), auth: toBase64Url(auth) },
    };
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const result = await sendWebPush(device, '{"title":"x"}', keys, 'https://service-hub.ro', { ttl: 600, urgency: 'high', fetch: fakeFetch });
    expect(result).toEqual({ outcome: 'sent', status: 201, error: undefined });
    const headers = seen!.init.headers as Record<string, string>;
    expect(seen!.url).toBe(device.endpoint);
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers.TTL).toBe('600');
    expect(headers.Urgency).toBe('high');
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(await decrypt(seen!.init.body as Uint8Array, receiver, auth)).toBe('{"title":"x"}');
  });

  it('a network failure is worth a retry, a dead subscription is not', async () => {
    const keys = await generateVapidKeys();
    const receiver = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const device = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/x',
      keys: { p256dh: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey))), auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    };
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect((await sendWebPush(device, '{}', keys, 'https://service-hub.ro', { fetch: down })).outcome).toBe('retry');
    const gone = (async () => new Response('unsubscribed', { status: 410 })) as unknown as typeof fetch;
    expect(await sendWebPush(device, '{}', keys, 'https://service-hub.ro', { fetch: gone })).toEqual({
      outcome: 'gone',
      status: 410,
      error: '410 unsubscribed',
    });
  });
});
