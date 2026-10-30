import { expect, test, type Page } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  SEED,
  SEED_PASSWORD,
  cardAction,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  rpcAs,
  serviceRest,
  shot,
  signIn,
  userIdOf,
  verifyPhoneByAdmin,
} from './support';

// T53 — no-shows: marked only after the slot and the grace period, the client's acknowledgement
// from the third one, the client's dispute and the admin's decision in Moderare, the dispute's
// status in the shop's history.

const name = () => test.info().project.name;
const rid = () => crypto.randomUUID();

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

function plate(): string {
  const letters = Array.from({ length: 3 }, () => 'ABCDEFGHJKLMNPRSTUVWXZ'[Math.floor(Math.random() * 22)]).join('');
  return `BV ${10 + Math.floor(Math.random() * 89)} ${letters}`;
}

const past = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** Date and time in Bucharest, `minutes` ago. */
function bucharestAgo(minutes: number): { date: string; slot: string } {
  const at = new Date(Date.now() - minutes * 60_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, slot: `${get('hour')}:${get('minute')}` };
}

/** A client of a new shop with `count` no-shows booked in the app; the phone is confirmed. */
async function clientWithNoShows(count: number, shopName: string) {
  const { email: shop, shopId } = await createBookableShop(shopName, ['ulei']);
  const client = await createUser('client');
  await verifyPhoneByAdmin(client);
  const clientId = await userIdOf(client);
  const rows = await serviceRest<{ id: string; ref: string }[]>(
    'bookings?select=id,ref',
    'POST',
    Array.from({ length: count }, (_, i) => ({
      shop_id: shopId,
      client_id: clientId,
      service_id: 'ulei',
      client_name: 'Maria Pop',
      car_snapshot: { make: 'Dacia', model: 'Logan', plate: plate() },
      date: past(5 + i * 7),
      slot: '10:00',
      status: 'no_show',
    })),
  );
  return { shop, shopId, client, clientId, bookings: rows };
}

async function signInAdmin(page: Page) {
  // The demo admin is shared by tests running in parallel: its saved language never changes.
  await page.route('**/rest/v1/profiles?*', (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue(),
  );
  await signIn(page, SEED.admin, SEED_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Panou principal' })).toBeVisible();
}

test.describe('T53 no-shows', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('three no-shows: the client confirms attendance before the request, then contests one', async ({ page }) => {
    const shopName = `Atelier T53 ${Date.now()}`;
    const { shopId, client, bookings } = await clientWithNoShows(3, shopName);
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);

    // Programări: a neutral notice, and each no-show may be contested.
    await page.goto('/c/programari');
    await expect(page.getByText('Neprezentări în ultimele 90 de zile: 3. La fiecare programare confirmi prezența')).toBeVisible();

    // A new request: the acknowledgement comes first.
    await page.goto(`/c/service/${shopId}/programare?pas=2&serviciu=ulei`);
    await expect(page.getByRole('heading', { level: 1, name: 'Alege ziua' })).toBeVisible();
    await page.getByRole('button', { name: /: \d+ loc/ }).first().click();
    await page.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();
    await page.getByLabel('Marcă').fill('Dacia');
    await page.getByLabel('Model').fill('Logan');
    const ack = page.getByRole('region', { name: 'Confirmă prezența' });
    await expect(ack).toContainText('Neprezentări în ultimele 90 de zile: 3.');
    await expect(page.getByRole('button', { name: 'Trimite cererea' })).toBeDisabled();
    await ack.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 't53-ack', name());
    const before = await page.evaluate(() => window.scrollY);
    await ack.getByText('Confirm că vin la programare').click();
    // Ticking never moves the page.
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(2);
    await page.getByRole('button', { name: 'Trimite cererea' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cerere trimisă' })).toBeVisible();

    // Contest the newest no-show.
    await page.goto(`/c/programari?p=${bookings[0]!.id}`);
    const card = page.locator(`#booking-${bookings[0]!.id}`);
    await card.getByRole('button', { name: 'Contestă neprezentarea' }).click();
    const panel = card.getByRole('heading', { name: 'Contestă neprezentarea' }).locator('..');
    await expect(panel.getByRole('button', { name: 'Trimite contestația' })).toBeDisabled();
    await panel.getByLabel('Ce s-a întâmplat').fill('Am fost la service la ora stabilită, mașina a rămas la recepție.');
    await card.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 't53-dispute-form', name());
    await panel.getByRole('button', { name: 'Trimite contestația' }).click();
    await expect(card.getByText('Contestație în analiză la echipa Service-Hub.')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Contestă neprezentarea' })).toHaveCount(0);
    await shot(page, 't53-dispute-pending', name());
    // A waiting dispute still counts until the admin decides (after the audit, variant A).
    await expect(page.getByText('Neprezentări în ultimele 90 de zile: 3. La fiecare programare confirmi prezența')).toBeVisible();
  });

  test('Moderare: the admin annuls a contested no-show; the client and the shop see it', async ({ page, browser }) => {
    const shopName = `Atelier T53 ${Date.now()}`;
    const { shop, client, bookings } = await clientWithNoShows(1, shopName);
    await rpcAs(client, 'dispute_no_show', {
      p_booking_id: bookings[0]!.id,
      p_reason: 'Service-ul a amânat programarea la telefon.',
      p_request_id: rid(),
    });

    await signInAdmin(page);
    await page.goto('/admin/moderare');
    await expect(page.getByRole('heading', { level: 1, name: 'Moderare' })).toBeVisible();
    const item = page.getByRole('listitem').filter({ hasText: shopName }).filter({ hasText: 'Service-ul a amânat programarea' });
    await expect(item).toBeVisible();
    await expect(item).toContainText(bookings[0]!.ref);
    await item.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 't53-moderation', name());
    await item.getByRole('button', { name: 'Anulează neprezentarea' }).click();
    await expect(item.getByText('Nu se mai ia în calcul nicăieri. Clientul este anunțat.')).toBeVisible();
    await item.getByLabel('Notă (opțional)').fill('Confirmat telefonic cu service-ul.');
    await item.getByRole('button', { name: 'Anulează neprezentarea' }).click();
    // Tests on other screen sizes run at the same time: only this shop's dispute counts.
    await expect(page.getByRole('listitem').filter({ hasText: shopName }).filter({ hasText: 'În analiză' })).toHaveCount(0);

    const [d] = await serviceRest<{ status: string; decision_note: string }[]>(
      `no_show_disputes?booking_id=eq.${bookings[0]!.id}&select=status,decision_note`,
      'GET',
    );
    expect(d).toMatchObject({ status: 'upheld', decision_note: 'Confirmat telefonic cu service-ul.' });

    // The client: accepted, and never the internal note.
    const clientPage = await (await browser.newContext()).newPage();
    await clientPage.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    await signIn(clientPage, client, PASSWORD);
    await expect(clientPage).toHaveURL(/\/c\/cauta/);
    await clientPage.goto(`/c/programari?p=${bookings[0]!.id}`);
    const card = clientPage.locator(`#booking-${bookings[0]!.id}`);
    await expect(card.getByText('Contestație acceptată. Neprezentarea a fost anulată.')).toBeVisible();
    await expect(clientPage.getByText('Confirmat telefonic')).toHaveCount(0);
    await clientPage.context().close();

    // The shop: its history says it.
    const shopPage = await (await browser.newContext()).newPage();
    await shopPage.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    await signIn(shopPage, shop, PASSWORD);
    await expect(shopPage).toHaveURL(/\/s\//);
    await shopPage.goto(`/s/istoric?q=${bookings[0]!.ref}`);
    // The job's details open with a tap on it.
    await shopPage.getByRole('button', { expanded: false }).filter({ hasText: 'Maria Pop' }).first().click();
    await expect(shopPage.getByText('Clientul nu s-a prezentat. Neprezentare anulată după contestație.')).toBeVisible();
    await shot(shopPage, 't53-history', name());
    await shopPage.context().close();
  });

  test('the shop marks a no-show only after the slot and the grace period', async ({ page }) => {
    const shopName = `Atelier T53 ${Date.now()}`;
    const { email: shop, shopId } = await createBookableShop(shopName, ['ulei'], { slot_minutes: 60 });
    const client = await createUser('client');
    const clientId = await userIdOf(client);
    // A confirmed booking on the next weekday at 10:00; the browser's clock is moved past it (the
    // database keeps the real time, so it refuses the mark itself).
    const day = nextWeekday();
    await serviceRest('bookings', 'POST', {
      shop_id: shopId,
      client_id: clientId,
      service_id: 'ulei',
      client_name: 'Andrei Toma',
      car_snapshot: { make: 'Dacia', model: 'Logan', plate: plate() },
      date: day,
      slot: '10:00',
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
    });
    await signIn(page, shop, PASSWORD);
    await expect(page).toHaveURL(/\/s\//);

    // 11:05: the slot ended at 11:00, 15 minutes of grace.
    await page.clock.setFixedTime(bucharestTime(day, '11:05'));
    await page.goto('/s/programari?tab=programate');
    const booking = page.getByRole('listitem').filter({ hasText: 'Andrei Toma' });
    await expect(booking).toContainText('Neprezentarea se poate marca de la 11:15.');
    await expect(await cardAction(booking, 'Neprezentat')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await booking.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 't53-grace', name());

    // 11:20: the mark is offered; the database still says it is too early (its clock is real).
    await page.clock.setFixedTime(bucharestTime(day, '11:20'));
    await page.reload();
    await expect(booking).not.toContainText('Neprezentarea se poate marca');
    await (await cardAction(booking, 'Neprezentat')).click();
    await expect(booking.getByText('Rămâne în istoricul clientului, care o poate contesta.')).toBeVisible();
    await booking.getByRole('button', { name: 'Marchează neprezentat' }).click();
    await expect(booking.getByText('Poți marca neprezentarea doar după ora programării și perioada de așteptare.')).toBeVisible();
    const [row] = await serviceRest<{ status: string }[]>(`bookings?shop_id=eq.${shopId}&select=status`, 'GET');
    expect(row!.status).toBe('confirmed');
  });
});

/** The next Monday–Friday after today, as YYYY-MM-DD (Bucharest). */
function nextWeekday(): string {
  const d = new Date(`${bucharestAgo(0).date}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** That day and time in Bucharest, as an instant. */
function bucharestTime(day: string, time: string): Date {
  // Bucharest is UTC+2 or UTC+3: try both, keep the one that reads back as asked.
  for (const offset of [3, 2]) {
    const at = new Date(`${day}T${time}:00+0${offset}:00`);
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
    if (local === time) return at;
  }
  throw new Error(`no such time ${day} ${time}`);
}
