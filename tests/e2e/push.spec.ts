import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  openAccount,
  rpcAs,
  serviceRest,
  shot,
  signIn,
  userIdOf,
} from './support';

// T12 — push notifications. The banner asks in the app first (never the browser on load); Cont
// shows the state and the control. The whole delivery path runs for real on the local stack: the
// booking change writes the outbox, the database wakes dispatch-notifications (pg_net), the
// function encrypts the notification and posts it to the device's push service — here a small
// server in this test, which decrypts it with the device keys. Headless Chromium has no push
// service of its own and always reports notifications as blocked, so the browser's permission
// answer and its PushManager are stand-ins here; everything after them is the real app.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

const name = () => test.info().project.name;
const pushBanner = (page: Page) => page.getByRole('region', { name: 'Notificări push' });
const pushRow = (page: Page, label = 'Notificări push') => page.getByRole('group', { name: label });

type Bytes = Uint8Array<ArrayBuffer>;
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const utf8 = (s: string) => new TextEncoder().encode(s) as Bytes;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm as Bytes, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as Bytes, info: info as Bytes }, key, length * 8),
  );
}

/** A device: its keys, and a push service that records what it receives. */
async function fakeDevice() {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const received: Buffer[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push(Buffer.concat(chunks));
      res.statusCode = 201;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  // The Edge Function runs in Docker; the runner is `host.docker.internal` from there.
  const origin = `http://host.docker.internal:${(server.address() as AddressInfo).port}`;

  async function decrypt(body: Buffer): Promise<{ title: string; body: string; url: string; tag: string }> {
    const bytes = new Uint8Array(body);
    const salt = bytes.slice(0, 16);
    const idLen = bytes[20]!;
    const asPublic = bytes.slice(21, 21 + idLen);
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, keys.privateKey, 256));
    const ikm = await hkdf(auth, shared, new Uint8Array([...utf8('WebPush: info\0'), ...publicRaw, ...asPublic]), 32);
    const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
    const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, bytes.slice(21 + idLen)));
    return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
  }

  async function next(): Promise<{ title: string; body: string; url: string; tag: string }> {
    const start = received.length;
    await expect.poll(() => received.length, { timeout: 20_000 }).toBeGreaterThan(start);
    return decrypt(received[received.length - 1]!);
  }

  return {
    endpoint: `${origin}/push/${crypto.randomUUID()}`,
    origin,
    p256dh: b64u(publicRaw),
    auth: b64u(auth),
    received,
    next,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * The browser's permission, as a person would answer its prompt: `initial` before asking, then
 * `answer` (kept across reloads, like a real browser).
 */
async function browserPermission(page: Page, initial: NotificationPermission, answer: NotificationPermission) {
  await page.addInitScript(
    ({ initial, answer }) => {
      const KEY = 'sh_test_notification_permission';
      Object.defineProperty(Notification, 'permission', {
        configurable: true,
        get: () => (localStorage.getItem(KEY) as NotificationPermission | null) ?? initial,
      });
      Notification.requestPermission = async () => {
        localStorage.setItem(KEY, answer);
        return answer;
      };
    },
    { initial, answer },
  );
}

/** Replaces the browser's PushManager with one that subscribes to the given device. */
async function useDevice(page: Page, device: { endpoint: string; p256dh: string; auth: string }) {
  await page.addInitScript((d) => {
    const KEY = 'sh_test_push_sub';
    const make = (serverKey: string) => ({
      endpoint: d.endpoint,
      expirationTime: null,
      options: { applicationServerKey: Uint8Array.from(atob(serverKey), (c) => c.charCodeAt(0)).buffer, userVisibleOnly: true },
      toJSON: () => ({ endpoint: d.endpoint, expirationTime: null, keys: { p256dh: d.p256dh, auth: d.auth } }),
      unsubscribe: async () => {
        localStorage.removeItem(KEY);
        return true;
      },
    });
    PushManager.prototype.subscribe = async function (options?: PushSubscriptionOptionsInit) {
      const key = options?.applicationServerKey as Uint8Array;
      const b64 = btoa(String.fromCharCode(...key));
      localStorage.setItem(KEY, b64);
      return make(b64) as unknown as PushSubscription;
    };
    PushManager.prototype.getSubscription = async function () {
      const b64 = localStorage.getItem(KEY);
      return (b64 ? make(b64) : null) as unknown as PushSubscription;
    };
  }, device);
}

async function freeSlot(email: string, shopId: string): Promise<{ date: string; slot: string }> {
  const av = await rpcAs<{ days: { date: string; bookable: boolean }[] }>(email, 'get_availability', { p_shop_id: shopId, p_days: 30 });
  for (const day of av.days.filter((d) => d.bookable)) {
    const s = await rpcAs<{ slots: { time: string; available: boolean }[] }>(email, 'get_availability', {
      p_shop_id: shopId,
      p_from: day.date,
      p_days: 1,
      p_slots_for: day.date,
    });
    const free = s.slots.find((x) => x.available);
    if (free) return { date: day.date, slot: free.time };
  }
  throw new Error('no free slot');
}

test.describe('push notifications', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test('the banner asks in the app first; "Nu acum" hides it; Cont shows the state', async ({ page }) => {
    const client = await createUser('client');
    await browserPermission(page, 'default', 'denied');
    let asked = false;
    await page.exposeFunction('shTestAsked', () => (asked = true));
    await page.addInitScript(() => {
      const ask = Notification.requestPermission;
      Notification.requestPermission = async () => {
        (window as unknown as { shTestAsked: () => void }).shTestAsked();
        return ask();
      };
    });
    await signIn(page, client, PASSWORD);
    await expect(page.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();

    const banner = pushBanner(page);
    await expect(banner).toContainText('Activează notificările ca să afli imediat de deviz');
    await expect(banner.getByRole('button', { name: 'Activează' })).toBeVisible();
    // Never the browser's prompt on its own.
    expect(asked).toBe(false);
    await expectNoHorizontalScroll(page);
    await shot(page, 't12-banner-client', name());

    const saved = page.waitForResponse((r) => r.url().includes('/rest/v1/profiles') && r.request().method() === 'PATCH');
    await banner.getByRole('button', { name: 'Nu acum' }).click();
    await expect(banner).toHaveCount(0);
    expect((await saved).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();
    await expect(pushBanner(page)).toHaveCount(0);

    await openAccount(page);
    const row = pushRow(page);
    await expect(row).toContainText('Dezactivate');
    await expect(row).toContainText('Le activezi separat pe fiecare telefon sau calculator.');
    await expect(row.getByRole('button', { name: 'Activează' })).toBeVisible();
    await shot(page, 't12-account-client', name());

    await page.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    await expect(pushRow(page, 'Push notifications')).toContainText('Off');
    await expect(pushRow(page, 'Push notifications').getByRole('button', { name: 'Turn on' })).toBeVisible();
    await shot(page, 't12-account-client-en', name());
  });

  test('blocked in the browser: no second ask, Cont says where to allow them', async ({ page }) => {
    const client = await createUser('client');
    await browserPermission(page, 'default', 'denied');
    await signIn(page, client, PASSWORD);
    await pushBanner(page).getByRole('button', { name: 'Activează' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Ai blocat notificările.' })).toContainText(
      'Le poți activa din setările browserului pentru acest site.',
    );
    await expect(pushBanner(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Închide' }).click();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();
    await expect(pushBanner(page)).toHaveCount(0);
    await openAccount(page);
    await expect(pushRow(page)).toContainText('Blocate de browser');
    await expect(pushRow(page)).toContainText('Le poți activa din setările browserului pentru acest site.');
    await expect(pushRow(page).getByRole('button')).toHaveCount(0);
    await shot(page, 't12-account-blocked', name());
  });

  test('the shop sees the banner on Panou and the row in Notificări', async ({ page }) => {
    const { email } = await createBookableShop(`Atelier T12 ${Date.now()}`, ['ulei']);
    await browserPermission(page, 'default', 'granted');
    await signIn(page, email, PASSWORD);
    await expect(page.getByRole('heading', { level: 1, name: 'Panou' })).toBeVisible();
    await expect(pushBanner(page)).toContainText('de cereri noi și de răspunsul clienților la deviz');
    await expectNoHorizontalScroll(page);
    await shot(page, 't12-banner-shop', name());
    await page.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    await expect(page.getByRole('region', { name: 'Push notifications' })).toContainText(
      'Turn on notifications to hear right away about new requests and how clients answer your quotes.',
    );
    await expectNoHorizontalScroll(page);
    await shot(page, 't12-banner-shop-en', name());
    await page.getByRole('button', { name: 'Română' }).filter({ visible: true }).first().click();
    await page.goto('/s/cont/setari/notificari');
    await expect(page.getByRole('heading', { level: 1, name: 'Notificări' })).toBeVisible();
    await expect(pushRow(page)).toContainText('Dezactivate');
    await expect(page.getByText('Rezumatul zilei ajunge pe dispozitivele unde ai activat notificările push.')).toBeVisible();
  });

  test.describe('delivered for real', () => {
    test('turn on → a booking change arrives on the device, in the client language → the tap opens it', async ({ page }) => {
      test.skip(name() !== 'desktop-1440', 'one delivery run is enough');
      const device = await fakeDevice();
      try {
        // Local test origins must be listed for the database to accept the device.
        const [config] = await serviceRest<{ extra_push_origins: string[] }[]>('push_config?id=eq.1&select=extra_push_origins', 'GET');
        await serviceRest('push_config?id=eq.1', 'PATCH', { extra_push_origins: [...new Set([...config!.extra_push_origins, device.origin])] });

        const { email: shop, shopId } = await createBookableShop(`Atelier Push ${Date.now()}`, ['ulei']);
        const client = await createUser('client');
        await browserPermission(page, 'default', 'granted');
        await useDevice(page, device);
        await signIn(page, client, PASSWORD);
        await expect(page.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();
        await pushBanner(page).getByRole('button', { name: 'Activează' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Notificările sunt activate pe acest dispozitiv.' })).toBeVisible();
        await openAccount(page);
        await expect(pushRow(page)).toContainText('Activate pe acest dispozitiv');
        const clientId = await userIdOf(client);
        const rows = await serviceRest<{ user_id: string }[]>(`push_subscriptions?endpoint=eq.${encodeURIComponent(device.endpoint)}&select=user_id`, 'GET');
        expect(rows).toEqual([{ user_id: clientId }]);

        // The shop confirms a request: the client's device gets it within seconds.
        const { date, slot } = await freeSlot(client, shopId);
        const booking = await rpcAs<{ id: string; ref: string }>(client, 'create_booking', {
          p_shop_id: shopId,
          p_service_id: 'ulei',
          p_date: date,
          p_slot: slot,
          p_car: { make: 'Dacia', model: 'Logan', plate: 'BV 12 PSH' },
          p_request_id: crypto.randomUUID(),
        });
        await rpcAs(shop, 'confirm_booking', { p_booking_id: booking.id, p_request_id: crypto.randomUUID() });
        const push = await device.next();
        expect(push.title).toMatch(/^Atelier Push/);
        expect(push.body).toMatch(new RegExp(`^Programarea ${booking.ref} este confirmată: .+, ${slot.slice(0, 5)}\\.$`));
        expect(push.url).toBe(`/c/programari?p=${booking.id}`);

        // A tap: the service worker hands the address to the open app, which shows that booking.
        await page.evaluate((url) => {
          navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'sh:navigate', url } }));
        }, push.url);
        await expect(page).toHaveURL(new RegExp(`/c/programari\\?p=${booking.id}$`));
        await expect(page.locator(`#booking-${booking.id}`)).toBeInViewport();
        await expect(page.locator(`#booking-${booking.id}`)).toContainText(booking.ref);

        // Turned off here: the device row is gone.
        await openAccount(page);
        await pushRow(page).getByRole('button', { name: 'Dezactivează' }).click();
        await expect(pushRow(page)).toContainText('Dezactivate pe acest dispozitiv');
        expect(await serviceRest(`push_subscriptions?endpoint=eq.${encodeURIComponent(device.endpoint)}`, 'GET')).toEqual([]);

        // On again, then signing out takes the device away from this account.
        await pushRow(page).getByRole('button', { name: 'Activează' }).click();
        await expect(pushRow(page)).toContainText('Activate pe acest dispozitiv');
        await page.getByRole('button', { name: 'Deconectare' }).filter({ visible: true }).first().click();
        await expect(page).toHaveURL(/\/$/);
        await expect
          .poll(() => serviceRest(`push_subscriptions?endpoint=eq.${encodeURIComponent(device.endpoint)}`, 'GET'))
          .toEqual([]);
      } finally {
        await device.close();
      }
    });
  });
});
