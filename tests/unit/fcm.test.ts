import { beforeEach, describe, expect, it } from 'vitest';
import {
  fcmBody,
  parseServiceAccount,
  resetFcmToken,
  sendFcm,
  serviceAccountJwt,
  type FcmConfig,
  type FcmMessage,
} from '../../supabase/functions/_shared/fcm';
import { fromBase64Url } from '../../supabase/functions/_shared/webpush';

async function serviceAccount() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = btoa(String.fromCharCode(...pkcs8));
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  const json = JSON.stringify({
    type: 'service_account',
    project_id: 'service-hub-test',
    private_key: pem,
    client_email: 'fcm@service-hub-test.iam.gserviceaccount.com',
    token_uri: 'https://oauth2.example/token',
  });
  return { json, publicKey: pair.publicKey };
}

const message: FcmMessage = {
  title: 'Atelier Unu',
  body: 'Devizul este gata.',
  url: '/c/programari?p=b-1',
  tag: 'booking-b-1',
  urgent: true,
  ttlSeconds: 86400,
};

/** A Google that hands out tokens and answers sends with the given status and body. */
function fakeGoogle(status = 200, body: unknown = { name: 'projects/x/messages/1' }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.includes('/token')) return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

beforeEach(() => resetFcmToken());

describe('Firebase Cloud Messaging', () => {
  it('reads the service account key, and nothing else', async () => {
    const { json } = await serviceAccount();
    expect(parseServiceAccount(json)).toMatchObject({ projectId: 'service-hub-test', tokenUri: 'https://oauth2.example/token' });
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount('not json')).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_info: { project_id: 'x' } }))).toBeNull(); // google-services.json
  });

  it('signs the assertion with the key (RS256), for the messaging scope, one hour', async () => {
    const { json, publicKey } = await serviceAccount();
    const jwt = await serviceAccountJwt(parseServiceAccount(json)!, Date.UTC(2026, 9, 1));
    const [h, c, s] = jwt.split('.');
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(c!)));
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(h!)))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(claims).toMatchObject({
      iss: 'fcm@service-hub-test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.example/token',
    });
    expect(claims.exp - claims.iat).toBe(3600);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, fromBase64Url(s!), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it('builds one message: the text, the screen to open, the channel, the tag that replaces older ones', () => {
    expect(fcmBody('tok', message)).toEqual({
      message: {
        token: 'tok',
        notification: { title: 'Atelier Unu', body: 'Devizul este gata.' },
        data: { url: '/c/programari?p=b-1', tag: 'booking-b-1' },
        android: {
          priority: 'HIGH',
          ttl: '86400s',
          collapse_key: 'booking-b-1',
          notification: { channel_id: 'service-hub', tag: 'booking-b-1', default_sound: true },
        },
      },
    });
    expect((fcmBody('tok', { ...message, urgent: false }).message as { android: { priority: string } }).android.priority).toBe('NORMAL');
  });

  it('sends with a token it gets once, to the project of the key', async () => {
    const { json } = await serviceAccount();
    const google = fakeGoogle();
    const config: FcmConfig = { account: parseServiceAccount(json), fetch: google.fetchFn, apiUrl: 'https://fcm.example' };
    expect(await sendFcm(config, 'tok-1', message)).toEqual({ outcome: 'sent' });
    expect(await sendFcm(config, 'tok-2', message)).toEqual({ outcome: 'sent' });
    expect(google.calls.filter((c) => c.url.includes('/token'))).toHaveLength(1);
    const send = google.calls.find((c) => c.url.includes('messages:send'))!;
    expect(send.url).toBe('https://fcm.example/v1/projects/service-hub-test/messages:send');
    expect((send.init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.test');
  });

  it('a token the phone no longer has is gone; Google busy is retried; a refusal fails', async () => {
    const { json } = await serviceAccount();
    const account = parseServiceAccount(json);
    const gone = fakeGoogle(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } });
    expect((await sendFcm({ account, fetch: gone.fetchFn }, 't', message)).outcome).toBe('gone');
    const busy = fakeGoogle(503, { error: { status: 'UNAVAILABLE' } });
    expect((await sendFcm({ account, fetch: busy.fetchFn }, 't', message)).outcome).toBe('retry');
    const refused = fakeGoogle(403, { error: { status: 'PERMISSION_DENIED' } });
    expect(await sendFcm({ account, fetch: refused.fetchFn }, 't', message)).toEqual({ outcome: 'failed', error: 'fcm 403 PERMISSION_DENIED' });
    expect(await sendFcm({ account: null }, 't', message)).toEqual({ outcome: 'failed', error: 'fcm_not_configured' });
  });
});
