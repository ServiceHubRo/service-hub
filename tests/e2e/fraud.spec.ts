import { expect, test, type Page } from '@playwright/test';
import { nextSms } from './providers';
import {
  BACKEND,
  PASSWORD,
  SEED,
  SEED_PASSWORD,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  openAccount,
  rpcAs,
  serviceRest,
  shot,
  signIn,
  totp,
  uniquePhone,
  userIdOf,
} from './support';

// T25 — fewer ways to cheat: the admin's second step of sign-in (first setup and every sign-in),
// the company checked at ANAF in Date de facturare (the ANAF stand-in in providers.ts), the
// suspicious reviews in Moderare, and a phone confirmed by SMS after repeated no-shows.

const name = () => test.info().project.name;
const rid = () => crypto.randomUUID();
const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';

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

/** A booking taken through the quote to a finished job, within a minute: the "quick job" sign. */
async function finishedJob(client: string, shop: string, shopId: string): Promise<{ id: string; ref: string }> {
  const av = await rpcAs<{ days: { date: string; bookable: boolean }[] }>(client, 'get_availability', { p_shop_id: shopId, p_days: 30 });
  const day = av.days.find((d) => d.bookable)!;
  const s = await rpcAs<{ slots: { time: string; available: boolean }[] }>(client, 'get_availability', {
    p_shop_id: shopId,
    p_from: day.date,
    p_days: 1,
    p_slots_for: day.date,
  });
  const booking = await rpcAs<{ id: string; ref: string }>(client, 'create_booking', {
    p_shop_id: shopId,
    p_service_id: 'ulei',
    p_date: day.date,
    p_slot: s.slots.find((x) => x.available)!.time,
    p_request_id: rid(),
    p_car: { make: 'Dacia', model: 'Logan', year: 2019, plate: plate() },
    p_save_car: false,
  });
  await rpcAs(shop, 'confirm_booking', { p_booking_id: booking.id, p_request_id: rid() });
  await rpcAs(shop, 'start_inspection', { p_booking_id: booking.id, p_request_id: rid() });
  await rpcAs(shop, 'send_quote', { p_booking_id: booking.id, p_items: [{ name: 'Ulei și filtru', price: 350 }], p_request_id: rid() });
  const [quote] = await serviceRest<{ id: string; quote_items: { id: string }[] }[]>(
    `quotes?booking_id=eq.${booking.id}&select=id,quote_items(id)`,
    'GET',
  );
  await rpcAs(client, 'decide_quote', {
    p_booking_id: booking.id,
    p_quote_id: quote!.id,
    p_approved_item_ids: quote!.quote_items.map((i) => i.id),
    p_request_id: rid(),
  });
  await rpcAs(shop, 'start_work', { p_booking_id: booking.id, p_request_id: rid() });
  await rpcAs(shop, 'complete_job', { p_booking_id: booking.id, p_odometer: 120000, p_request_id: rid() });
  return booking;
}

async function setLanguage(page: Page, lang: 'ro' | 'en') {
  await page.getByRole('link', { name: lang === 'en' ? 'Cont' : 'Account', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: lang === 'en' ? 'English' : 'Română' }).filter({ visible: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: lang === 'en' ? 'Account' : 'Cont' })).toBeVisible();
}

/** The access token the app keeps for the signed-in user. */
async function accessToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('sb-') && k.endsWith('-auth-token')) return (JSON.parse(localStorage.getItem(k)!) as { access_token: string }).access_token;
    }
    return '';
  });
}

test.describe('T25 fraud checks', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(150_000);

  test('the admin sets up the authenticator app, then every sign-in asks for its code', async ({ page }) => {
    // One account for the first setup: one project does it, and shows the other widths on the way.
    test.skip(name() !== 'desktop-1440', 'the first setup runs once');
    const admin = 'admin-nou@service-hub.test';
    // The demo admin's saved language never changes (the account is shared with other tests).
    await page.route('**/rest/v1/profiles?*', (route) =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue(),
    );
    await signIn(page, admin, SEED_PASSWORD);
    await expect(page.getByRole('heading', { level: 1, name: 'Verificarea în doi pași' })).toBeVisible();
    await expect(page.getByText('o parolă furată nu ajunge')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
    await shot(page, 't25-mfa-intro', 'mobile-390');
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByRole('button', { name: 'Pornește configurarea' }).click();
    await expect(page.getByRole('img', { name: 'Cod QR pentru aplicația de autentificare' })).toBeVisible();
    const secret = (await page.getByText(/^[A-Z2-7]{16,}$/).textContent())!.trim();
    await page.getByLabel('Codul de 6 cifre').fill('000000');
    await page.getByRole('button', { name: 'Activează' }).click();
    await expect(page.getByText('Codul nu este corect sau a expirat.', { exact: false })).toBeVisible();
    await shot(page, 't25-mfa-enroll', name());
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
    await shot(page, 't25-mfa-enroll', 'mobile-390');
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByLabel('Codul de 6 cifre').fill(totp(secret));
    await page.getByRole('button', { name: 'Activează' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Panou principal' })).toBeVisible();
    const token = await accessToken(page);

    // A new sign-in: the code, in English this time.
    await page.context().clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('sh_lang', 'ro');
    });
    await page.goto('/intra');
    await page.getByLabel('Email').fill(admin);
    await page.getByLabel('Parolă', { exact: true }).fill(SEED_PASSWORD);
    await page.getByRole('button', { name: 'Intră în cont' }).click();
    await expect(page.getByText('Scrie codul de 6 cifre din aplicația de autentificare de pe telefon.')).toBeVisible();
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByText('Type the 6-digit code from the authenticator app on your phone.')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't25-mfa-challenge-en', name());
    await page.getByLabel('6-digit code').fill(totp(secret));
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    // Without the second step the database refuses the admin's work (a password alone is aal1).
    const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: admin, password: SEED_PASSWORD }),
    });
    const aal1 = ((await res.json()) as { access_token: string }).access_token;
    const refused = await fetch(`${API}/rest/v1/rpc/admin_overview`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${aal1}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(refused.ok).toBe(false);
    expect(((await refused.json()) as { message: string }).message).toBe('mfa_required');

    // Leave the account as the seed made it, for the next run.
    const user = (await (await fetch(`${API}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } })).json()) as {
      factors?: { id: string }[];
    };
    for (const f of user.factors ?? []) {
      await fetch(`${API}/auth/v1/factors/${f.id}`, { method: 'DELETE', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } });
    }
  });

  test('Date de facturare: the company is checked at ANAF after saving', async ({ page }) => {
    const { email: owner } = await createBookableShop(`Atelier T25 ${Date.now()}`, ['ulei']);
    await signIn(page, owner, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou/);
    await page.goto('/s/cont/setari/facturare');
    const card = page.getByRole('region', { name: 'Firma la ANAF' });
    await expect(card).toContainText('După ce completezi CUI-ul și salvezi');

    await page.getByLabel('Denumire legală').fill('Auto Test SRL');
    await page.getByLabel('CUI / Cod fiscal').fill('RO18000003');
    await page.getByRole('button', { name: 'Salvează datele de facturare' }).click();
    await expect(card).toContainText('Verificat la ANAF: AUTO TEST S.R.L., firmă activă.');
    await expect(card).toContainText('La ANAF firma este plătitoare de TVA.');
    await card.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 't25-anaf-ok', name());

    // Another legal name: ANAF knows the CUI under its own name.
    await page.getByLabel('Denumire legală').fill('Alt Nume SRL');
    await page.getByRole('button', { name: 'Salvează datele de facturare' }).click();
    await expect(card).toContainText('La ANAF, CUI-ul acesta este al firmei „AUTO TEST S.R.L.”.');
    await card.scrollIntoViewIfNeeded();
    await shot(page, 't25-anaf-mismatch', name());

    // An inactive company, then an unknown CUI.
    await page.getByLabel('CUI / Cod fiscal').fill('18000011');
    await page.getByRole('button', { name: 'Salvează datele de facturare' }).click();
    await expect(card).toContainText('apare inactivă fiscal');
    await page.getByLabel('CUI / Cod fiscal').fill('160796');
    await page.getByRole('button', { name: 'Salvează datele de facturare' }).click();
    await expect(card).toContainText('ANAF nu are nicio firmă cu acest CUI.');

    await setLanguage(page, 'en');
    await page.goto('/s/cont/setari/facturare');
    const cardEn = page.getByRole('region', { name: 'Company at ANAF' });
    await expect(cardEn).toContainText('ANAF has no company with this CUI.');
    await expect(cardEn.getByRole('button', { name: 'Check again' })).toBeVisible();
    await cardEn.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 't25-anaf-en', name());
  });

  test('Moderare: a review that looks staged is listed with why; "E în regulă" takes it off', async ({ page }) => {
    const shopName = `Atelier T25 ${Date.now()}`;
    const { email: shop, shopId } = await createBookableShop(shopName, ['ulei']);
    const client = await createUser('client');
    const booking = await finishedJob(client, shop, shopId);
    await rpcAs(client, 'submit_review', { p_booking_id: booking.id, p_rating: 5, p_text: 'Cel mai bun service', p_request_id: rid() });

    // The demo admin is shared by tests running in parallel: its saved language never changes.
    await page.route('**/rest/v1/profiles?*', (route) =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue(),
    );
    await signIn(page, SEED.admin, SEED_PASSWORD);
    await expect(page.getByRole('heading', { level: 1, name: 'Panou principal' })).toBeVisible();
    await page.getByRole('link', { name: 'Moderare', exact: true }).filter({ visible: true }).first().click();
    const card = page.getByRole('listitem').filter({ hasText: shopName }).filter({ hasText: 'Lucrare în câteva minute' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Lucrarea a fost terminată la mai puțin de 3 ore după ce s-a făcut programarea.');
    await card.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 't25-suspect', name());

    await card.getByRole('button', { name: 'E în regulă' }).click();
    await expect(card.getByText('Recenzia rămâne publicată și iese din această listă.')).toBeVisible();
    await card.getByRole('button', { name: 'E în regulă' }).click();
    await expect(card).toHaveCount(0);
    const [review] = await serviceRest<{ signals_cleared_at: string | null; removed_at: string | null }[]>(
      `reviews?booking_id=eq.${booking.id}&select=signals_cleared_at,removed_at`,
      'GET',
    );
    expect(review!.signals_cleared_at).not.toBeNull();
    expect(review!.removed_at).toBeNull();
  });

  test('after two no-shows the client confirms the phone by SMS, then books', async ({ page }) => {
    const shopName = `Atelier T25 ${Date.now()}`;
    const { shopId } = await createBookableShop(shopName, ['ulei']);
    const phone = uniquePhone();
    const client = await createUser('client', { phone: phone.e164 });
    const clientId = await userIdOf(client);
    const past = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    await serviceRest('bookings', 'POST', [10, 20].map((d) => ({
      shop_id: shopId,
      client_id: clientId,
      service_id: 'ulei',
      client_name: 'Maria Pop',
      car_snapshot: { make: 'Dacia', model: 'Logan', plate: plate() },
      date: past(d),
      slot: '10:00',
      status: 'no_show',
    })));

    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await page.goto(`/c/service/${shopId}/programare?pas=2&serviciu=ulei`);
    await expect(page.getByRole('heading', { level: 1, name: 'Alege ziua' })).toBeVisible();
    await page.getByRole('button', { name: /: \d+ loc/ }).first().click();
    await page.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();
    await page.getByLabel('Marcă').fill('Dacia');
    await page.getByLabel('Model').fill('Logan');
    await page.getByRole('button', { name: 'Trimite cererea' }).click();

    const panel = page.getByRole('region', { name: 'Confirmă numărul de telefon' });
    await expect(panel).toContainText('Ai lipsit de la 2 programări în ultimele 90 de zile');
    await panel.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 't25-noshow-phone', name());
    // Sending again would be refused the same way: the button waits for the confirmed number.
    await expect(page.getByRole('button', { name: 'Trimite cererea' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Trimite codul' }).click();
    const sms = await nextSms(phone.e164);
    await panel.getByLabel('Codul din SMS').fill(/\b(\d{6})\b/.exec(sms.body)![1]!);
    await panel.getByRole('button', { name: 'Confirmă numărul' }).click();
    await expect(panel).toContainText('Număr confirmat.');
    await page.getByRole('button', { name: 'Trimite cererea' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cerere trimisă' })).toBeVisible();
  });

  test('Cont: nothing changes for a client with a confirmed phone', async ({ page }) => {
    // The account screen still shows the client's usual rows (no phone card for clients).
    const client = await createUser('client');
    await signIn(page, client, PASSWORD);
    await openAccount(page);
    await expect(page.getByRole('heading', { name: 'Confirmă numărul de telefon' })).toHaveCount(0);
  });
});
