import { expect, test, type Page } from '@playwright/test';
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
  userIdOf,
} from './support';

// Zones (Eduard, 8 Oct): a client whose position is in a county where Service-Hub does not work
// yet asks to be told, adds details or leaves the list; the admin sees the zones and turns one on,
// which tells the waiting clients once. And the constatare tehnică on step 1 of booking.

const name = () => test.info().project.name;
const rid = () => crypto.randomUUID();
const tag = () => `${Date.now() % 100000}${Math.floor(Math.random() * 100)}`;

// Each screen size its own county, so the runs in parallel never meet.
const CLIENT_ZONE: Record<string, { at: { latitude: number; longitude: number }; ro: string; en: string }> = {
  'mobile-390': { at: { latitude: 45.18, longitude: 28.8 }, ro: 'județul Tulcea', en: 'Tulcea County' },
  'tablet-820': { at: { latitude: 46.64, longitude: 27.73 }, ro: 'județul Vaslui', en: 'Vaslui County' },
  'desktop-1440': { at: { latitude: 47.75, longitude: 26.67 }, ro: 'județul Botoșani', en: 'Botoșani County' },
};
const ADMIN_ZONE: Record<string, { code: string; ro: string }> = {
  'mobile-390': { code: 'MH', ro: 'Mehedinți' },
  'tablet-820': { code: 'GR', ro: 'Giurgiu' },
  'desktop-1440': { code: 'SJ', ro: 'Sălaj' },
};

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

/** The language is the account's (profiles.lang): set it there, then reload. */
async function setLang(page: Page, userId: string, lang: 'ro' | 'en') {
  await serviceRest(`profiles?id=eq.${userId}`, 'PATCH', { lang });
  await page.evaluate((l) => localStorage.setItem('sh_lang', l), lang);
  await page.reload();
}

test.describe('zones', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test('a client outside our zones asks to be told, adds details and leaves the list', async ({ page, context }) => {
    const zone = CLIENT_ZONE[name()]!;
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(zone.at);
    const client = await createUser('client');
    const clientId = await userIdOf(client);
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);

    const card = page.getByRole('region', { name: `În curând și în ${zone.ro}` });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Te anunțăm pe email când devin disponibile');
    await expectNoHorizontalScroll(page);
    await shot(page, 'zones-offer', name());
    await card.getByRole('button', { name: 'Anunță-mă' }).click();

    const waiting = page.getByRole('region', { name: `Te anunțăm când ajungem în ${zone.ro}` });
    await expect(waiting).toBeVisible();
    await expect(waiting.getByRole('link', { name: 'Adaugă mașina' })).toBeVisible();
    await shot(page, 'zones-waiting', name());

    // Details: the town and what they need, saved without leaving the card.
    await waiting.getByRole('button', { name: 'Adaugă detalii' }).click();
    await page.getByLabel('Localitatea (opțional)').fill('Comuna Test');
    await page.getByRole('button', { name: 'Frânare' }).click();
    await expect(page.getByRole('button', { name: 'Frânare', pressed: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 'zones-details', name());
    await page.getByRole('button', { name: 'Salvează', exact: true }).click();
    await expect(waiting.getByRole('status')).toHaveText('Salvat.');
    const [row] = await serviceRest<{ locality: string; categories: string[]; notified_at: string | null }[]>(
      `area_waitlist?client_id=eq.${clientId}&select=locality,categories,notified_at`,
      'GET',
    );
    expect(row).toMatchObject({ locality: 'Comuna Test', categories: ['cat_fra'], notified_at: null });

    // In English.
    await setLang(page, clientId, 'en');
    await expect(page.getByRole('region', { name: `We'll let you know when we reach ${zone.en}` })).toBeVisible();
    await shot(page, 'zones-waiting-en', name());
    await setLang(page, clientId, 'ro');

    // "Nu mai vreau": asked inline, then the offer is back.
    await page.getByRole('button', { name: 'Nu mai vreau să fiu anunțat' }).click();
    await expect(page.getByRole('heading', { name: 'Renunți la notificare?' })).toBeVisible();
    await page.getByRole('button', { name: 'Da, renunț' }).click();
    await expect(page.getByRole('region', { name: `În curând și în ${zone.ro}` })).toBeVisible();
    expect(await serviceRest<unknown[]>(`area_waitlist?client_id=eq.${clientId}`, 'GET')).toEqual([]);
  });

  test('where Service-Hub works, no card', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 45.6427, longitude: 25.5887 }); // Brașov: the demo shops
    await signIn(page, SEED.client, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await expect(page.getByRole('heading', { level: 2, name: /Aproape de tine/ })).toBeVisible();
    await expect(page.getByRole('region', { name: /În curând și în/ })).toHaveCount(0);
  });

  test('the admin sees the zones and turns one on: the waiting client is told once', async ({ page }) => {
    const zone = ADMIN_ZONE[name()]!;
    const client = await createUser('client');
    const clientId = await userIdOf(client);
    await rpcAs(client, 'join_area_waitlist', { p_area: zone.code, p_locality: 'Test', p_categories: ['cat_rev'], p_request_id: rid() });

    // The demo admin is shared by tests running in parallel: its saved language never changes.
    await page.route('**/rest/v1/profiles?*', (route) =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue(),
    );
    await signIn(page, SEED.admin, SEED_PASSWORD);
    await expect(page.getByRole('heading', { level: 1, name: 'Panou principal' })).toBeVisible();
    await openAccount(page);
    await page.getByRole('link', { name: /^Zone/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Zone' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 'zones-admin', name());

    const card = page.locator('main li').filter({ has: page.getByRole('heading', { name: zone.ro, exact: true }) });
    await expect(card).toContainText('Nepornită');
    await expect(card).toContainText('Test (');
    await card.getByRole('button', { name: 'Pornită' }).click();
    await expect(card.getByRole('heading', { name: `Pornești zona ${zone.ro}?` })).toBeVisible();
    await shot(page, 'zones-admin-confirm', name());
    await card.getByRole('button', { name: 'Da, pornește' }).click();
    // The demo admin is shared by the runs in parallel: its session may refresh meanwhile.
    await expect(page.getByRole('status').filter({ hasText: /Am anunțat \d+ client/ })).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText('Pornită', { exact: true }).first()).toBeVisible();
    await expect(card).toContainText('Setată de tine');

    const events = await serviceRest<{ channels: string[] }[]>(
      `notification_events?user_id=eq.${clientId}&event=eq.area_launched&select=channels`,
      'GET',
    );
    expect(events).toEqual([{ channels: ['push', 'email'] }]);

    // Back to automatic (no public shop there): not live; nobody is told again.
    await card.getByRole('button', { name: 'Automat' }).click();
    await expect(card).toContainText('Nepornită');
    expect(
      await serviceRest<unknown[]>(`notification_events?user_id=eq.${clientId}&event=eq.area_launched`, 'GET'),
    ).toHaveLength(1);
  });
});

test.describe('constatare tehnică', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test('the client picks it with symptoms; the shop gets them in the note', async ({ page }) => {
    const shopName = `Atelier Constatare ${tag()}`;
    const { shopId } = await createBookableShop(shopName, ['constatare', 'ulei']);
    const client = await createUser('client');
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await page.goto(`/c/service/${shopId}/programare`);

    // Step 1: first, on its own; the symptoms appear once it is picked.
    const unsure = page.getByRole('button', { name: /^Constatare tehnică/ });
    await expect(unsure).toBeVisible();
    await expect(page.getByRole('group', { name: 'Simptome observate (opțional)' })).toHaveCount(0);
    await unsure.click();
    await page.getByRole('button', { name: 'Zgomote neobișnuite' }).click();
    await page.getByRole('button', { name: 'Martor aprins în bord' }).click();
    await expect(page).toHaveURL(/simptome=noise%2Cwarning_light|simptome=noise,warning_light/);
    await expectNoHorizontalScroll(page);
    await shot(page, 'constatare-step1', name());
    await page.getByRole('button', { name: /^Continuă/ }).click();

    await page.getByRole('button', { name: /: \d+ loc/ }).first().click();
    await page.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();

    // Step 4: the note is the description of the symptoms; the summary lists them.
    await expect(page.getByRole('heading', { level: 1, name: 'Mașina' })).toBeVisible();
    await page.getByLabel('Marcă').fill('Dacia');
    await page.getByLabel('Model').fill('Logan');
    await page.getByLabel('Descrierea simptomelor').fill('Apare la rece, dimineața.');
    await expect(page.getByText('Zgomote neobișnuite, Martor aprins în bord')).toBeVisible();
    await shot(page, 'constatare-step4', name());
    await page.getByRole('button', { name: 'Trimite cererea' }).click();
    await expect(page).toHaveURL(/\/programare\/trimisa/);

    const [booking] = await serviceRest<{ note: string; service_id: string }[]>(
      `bookings?shop_id=eq.${shopId}&select=note,service_id`,
      'GET',
    );
    expect(booking).toEqual({
      service_id: 'constatare',
      note: 'Simptome semnalate: zgomote neobișnuite, martor aprins în bord.\nApare la rece, dimineața.',
    });
  });
});
