import { expect, test, type Page } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  SEED,
  SEED_PASSWORD,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  isDesktop,
  rpcAs,
  serviceRest,
  shot,
  signIn,
} from './support';

// T19c — the launch check (docs/LAUNCH_CHECK.md): the points of the "Final check" list that no
// other browser test covered directly. Each test names the line of the list it proves.

test.skip(!BACKEND, 'needs the local Supabase stack');

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const name = () => test.info().project.name;
const rid = () => crypto.randomUUID();

/** A signed-in user's access token: exactly what the app holds in the browser. */
async function tokenOf(email: string, password: string): Promise<string> {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(res.ok, await res.clone().text()).toBe(true);
  return ((await res.json()) as { access_token: string }).access_token;
}

/**
 * What someone could type in the browser console with their own session: a request straight to
 * the database API, past the app. Answers the status and the rows it touched (or the error).
 */
async function asUser(token: string, method: 'GET' | 'PATCH' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

/** A write the database must refuse: an error, or no row touched. */
function expectRefused(result: { status: number; json: unknown }, what: string) {
  const touched = Array.isArray(result.json) ? result.json.length : 0;
  expect(result.status >= 400 || touched === 0, `${what}: ${result.status} ${JSON.stringify(result.json)}`).toBe(true);
}

// ------------------------------------------------------------------ Reguli care nu se văd

test('the browser console cannot change what the database protects', async () => {
  // A database check, the same at every width: once is enough.
  test.skip(name() !== 'desktop-1440', 'no screen involved');
  const [shop] = await serviceRest<{ id: string; active: boolean; suspended: boolean }[]>(
    'shops?name=eq.Atelier%20Demo&select=id,active,suspended',
    'GET',
  );
  const [sub] = await serviceRest<{ status: string }[]>(`subscriptions?shop_id=eq.${shop!.id}&select=status`, 'GET');
  const shopToken = await tokenOf(SEED.shop, SEED_PASSWORD);
  const clientToken = await tokenOf(SEED.client, SEED_PASSWORD);

  // „UPDATE shops SET plan='standard'”: the subscription, active and suspended belong to the platform.
  expectRefused(await asUser(shopToken, 'PATCH', `subscriptions?shop_id=eq.${shop!.id}`, { status: 'active', price_ron: 1 }), 'shop: own subscription');
  expectRefused(await asUser(shopToken, 'PATCH', `shops?id=eq.${shop!.id}`, { active: true, suspended: false }), 'shop: active/suspended');
  expectRefused(await asUser(shopToken, 'PATCH', `profiles?email=eq.${encodeURIComponent(SEED.shop)}`, { role: 'admin' }), 'shop: becomes admin');

  // „Un cont de service nu poate citi tabelul cars”.
  const cars = await asUser(shopToken, 'GET', 'cars?select=id,plate');
  expect(cars.status).toBe(200);
  expect(cars.json).toEqual([]);

  // A quote the client received: neither its lines nor its total can be changed by the client.
  const [quote] = await serviceRest<{ id: string; booking_id: string; total_sent: number }[]>(
    `quotes?status=eq.sent&select=id,booking_id,total_sent,bookings!inner(shop_id)&bookings.shop_id=eq.${shop!.id}&limit=1`,
    'GET',
  );
  expect(quote, 'the demo data has a quote waiting for the client').toBeTruthy();
  const [item] = await serviceRest<{ id: string; price: number }[]>(`quote_items?quote_id=eq.${quote!.id}&select=id,price&limit=1`, 'GET');
  expectRefused(await asUser(clientToken, 'PATCH', `quote_items?id=eq.${item!.id}`, { price: 1 }), 'client: quote line price');
  expectRefused(await asUser(clientToken, 'PATCH', `quotes?id=eq.${quote!.id}`, { total_sent: 1 }), 'client: quote total');
  expectRefused(await asUser(clientToken, 'PATCH', `bookings?id=eq.${quote!.booking_id}`, { status: 'done' }), 'client: booking status');

  // „Un service nu poate accepta el însuși devizul în locul clientului”.
  const decided = await asUser(shopToken, 'POST', 'rpc/decide_quote', {
    p_booking_id: quote!.booking_id,
    p_quote_id: quote!.id,
    p_approved_item_ids: [item!.id],
    p_request_id: rid(),
  });
  expect(decided.status, JSON.stringify(decided.json)).toBeGreaterThanOrEqual(400);

  // Nothing moved.
  const [after] = await serviceRest<{ active: boolean; suspended: boolean }[]>(`shops?id=eq.${shop!.id}&select=active,suspended`, 'GET');
  expect(after).toEqual({ active: shop!.active, suspended: shop!.suspended });
  const [subAfter] = await serviceRest<{ status: string }[]>(`subscriptions?shop_id=eq.${shop!.id}&select=status`, 'GET');
  expect(subAfter!.status).toBe(sub!.status);
  const [quoteAfter] = await serviceRest<{ status: string; total_sent: number }[]>(`quotes?id=eq.${quote!.id}&select=status,total_sent`, 'GET');
  expect(quoteAfter).toEqual({ status: 'sent', total_sent: quote!.total_sent });
  const [itemAfter] = await serviceRest<{ price: number }[]>(`quote_items?id=eq.${item!.id}&select=price`, 'GET');
  expect(itemAfter!.price).toBe(item!.price);
});

// ------------------------------------------------------------------ Structură

test('loading shows three skeleton cards, never the empty state first', async ({ page }) => {
  const email = await createUser('client');
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta$/);

  // The bookings answer is held back, as on a slow connection.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/rest/v1/bookings?*', async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole('link', { name: 'Programări', exact: true }).filter({ visible: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Programări' })).toBeVisible();
  const skeleton = page.locator('main [aria-busy="true"]');
  await expect(skeleton).toBeVisible();
  await expect(skeleton.locator(':scope > [aria-hidden="true"]')).toHaveCount(3);
  await expect(page.getByText('Nicio programare încă.')).toHaveCount(0);
  await shot(page, 't19c-loading', name());

  // Once the (empty) answer arrives: the empty state, and the skeletons are gone.
  release();
  await expect(page.getByText('Nicio programare încă.')).toBeVisible();
  await expect(skeleton).toHaveCount(0);
  await shot(page, 't19c-empty', name());
});

test('the fourth active booking at the same shop is refused with a clear message', async ({ page }) => {
  const { shopId } = await createBookableShop(`Atelier Limită ${Date.now() % 100000}`, ['frane']);
  const client = await createUser('client');

  // Three active bookings already (the default limit per shop).
  const av = await rpcAs<{ days: { date: string; bookable: boolean }[] }>(client, 'get_availability', { p_shop_id: shopId, p_days: 30 });
  const days = av.days.filter((d) => d.bookable).map((d) => d.date);
  for (let i = 0; i < 3; i++) {
    await rpcAs(client, 'create_booking', {
      p_shop_id: shopId,
      p_service_id: 'frane',
      p_date: days[i],
      p_slot: '10:00',
      p_request_id: rid(),
      p_car: { make: 'Dacia', model: 'Logan', plate: `BV 0${i} LIM` },
    });
  }

  await signIn(page, client, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta$/);
  await page.goto(`/c/service/${shopId}/programare?pas=2&serviciu=frane`);
  await page.getByRole('button', { name: /: \d+ locuri?$/ }).last().click();
  await page.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();
  await page.getByLabel('Marcă').fill('Dacia');
  await page.getByLabel('Model').fill('Sandero');
  await page.getByRole('button', { name: 'Trimite cererea' }).click();
  // Under the button, brought fully on screen (on a phone the button sits at the bottom).
  await expect(page.getByText('Ai deja 3 programări active la acest service.')).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('heading', { level: 1, name: 'Cerere trimisă' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await shot(page, 't19c-fourth-booking', name());
  const rows = await serviceRest<unknown[]>(`bookings?shop_id=eq.${shopId}&select=id`, 'GET');
  expect(rows).toHaveLength(3);
});

// ------------------------------------------------------------------ Prezentare

async function signInSeed(page: Page, email: string) {
  // Shared demo accounts: their saved language is never rewritten from here.
  await page.route('**/rest/v1/profiles?*', (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue(),
  );
  await signIn(page, email, SEED_PASSWORD);
  await expect(page).not.toHaveURL(/\/intra/);
}

test('search results stand one under another, at every width', async ({ page }) => {
  await signInSeed(page, SEED.client);
  await expect(page.getByRole('article').nth(1)).toBeVisible();
  const boxes = await page.getByRole('article').evaluateAll((cards) =>
    cards.map((c) => {
      const r = c.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom) };
    }),
  );
  expect(boxes.length).toBeGreaterThan(1);
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i]!.left, `card ${i + 1} in the same column`).toBe(boxes[0]!.left);
    expect(boxes[i]!.top, `card ${i + 1} below the one before`).toBeGreaterThanOrEqual(boxes[i - 1]!.bottom);
  }
  await expectNoHorizontalScroll(page);
});

test('at 1440 px the navigation is on the left, with Cont and Deconectare at the bottom', async ({ page }) => {
  test.skip(!isDesktop(page), 'the sidebar is the desktop layout');
  for (const email of [SEED.client, SEED.shop]) {
    await signInSeed(page, email);
    const sidebar = page.locator('aside').filter({ has: page.getByRole('navigation') });
    const side = (await sidebar.boundingBox())!;
    expect(side.x).toBe(0);
    expect(side.width).toBeLessThan(320);
    const account = (await sidebar.getByRole('link', { name: 'Cont', exact: true }).boundingBox())!;
    const logout = (await sidebar.getByRole('button', { name: 'Deconectare' }).boundingBox())!;
    const lastMain = (await sidebar.getByRole('navigation').getByRole('link').last().boundingBox())!;
    // Pinned to the bottom, under the main items, Deconectare last.
    expect(account.y).toBeGreaterThan(lastMain.y);
    expect(logout.y).toBeGreaterThan(account.y);
    expect(logout.y + logout.height).toBeGreaterThan(page.viewportSize()!.height * 0.8);
    await shot(page, `t19c-sidebar-${email.split('@')[0]}`, name());
    await sidebar.getByRole('button', { name: 'Deconectare' }).click();
    await sidebar.getByRole('button', { name: 'Deconectează-mă' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});
