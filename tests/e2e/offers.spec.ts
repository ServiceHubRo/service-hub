import { expect, test } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  serviceRest,
  shot,
  signIn,
  userIdOf,
} from './support';

// New-client offers (T23): the owner picks a discount on labor for first bookings; a new client
// sees it on the search card, the shop page and the booking summary; the booking keeps it and the
// shop sees it on the card and in the quote form; the same client then no longer sees it.

const name = () => test.info().project.name;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

test.describe('new-client offers', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(90_000);

  test('the owner sets it, a new client sees it and books with it, the shop sees the promise', async ({ page, browser }) => {
    const shopName = `Atelier Ofertă ${Date.now() % 100000}${Math.floor(Math.random() * 100)}`;
    const { email: shopEmail, shopId } = await createBookableShop(shopName, ['ulei']);

    // ------------------------------------------------------------ the owner, Setări → Reguli
    await signIn(page, shopEmail, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await page.goto('/s/cont/setari/reguli');
    const offer = page.getByRole('group', { name: 'Ofertă pentru clienți noi' });
    await expect(offer.getByRole('button', { name: 'Fără ofertă', pressed: true })).toBeVisible();
    await offer.getByRole('button', { name: '-10%' }).click();
    await expect(offer.getByRole('button', { name: '-10%', pressed: true })).toBeVisible();
    await offer.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 'offer-settings', name());
    await page.getByRole('button', { name: 'Salvează regulile' }).click();
    await expect(page.getByRole('button', { name: /Salvat/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('group', { name: 'Ofertă pentru clienți noi' }).getByRole('button', { name: '-10%', pressed: true })).toBeVisible();

    // ------------------------------------------------------------ a new client
    const clientContext = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    await clientContext.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    const client = await clientContext.newPage();
    await signIn(client, await createUser('client'), PASSWORD);
    await expect(client).toHaveURL(/\/c\/cauta$/);
    await client.goto(`/c/cauta?q=${encodeURIComponent(shopName)}`);
    const card = client.locator('article').filter({ hasText: shopName });
    await expect(card).toContainText('-10% la manoperă la prima programare');
    await expectNoHorizontalScroll(client);
    await shot(client, 'offer-search-card', name());

    await card.getByRole('link').first().click();
    await expect(client.getByRole('heading', { level: 1, name: shopName })).toBeVisible();
    await expect(client.getByText('-10% la manoperă la prima ta programare aici.', { exact: false })).toBeVisible();
    await expectNoHorizontalScroll(client);
    await shot(client, 'offer-shop-page', name());

    await client.getByRole('link', { name: 'Programează-te' }).click();
    await client.getByRole('button', { name: 'Schimb ulei + filtru ulei' }).click();
    await client.getByRole('button', { name: /^Continuă/ }).click();
    await client.getByRole('button', { name: /: \d+ loc(uri)?$/ }).first().click();
    await client.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();
    await client.getByLabel('Marcă').fill('Skoda');
    await client.getByLabel('Model').fill('Octavia');
    await client.getByLabel('Nr. înmatriculare').fill(`BV ${Math.floor(10 + Math.random() * 89)} OFR`);
    await expect(client.getByText('Prima ta programare aici: -10% la manoperă.', { exact: false })).toBeVisible();
    await expectNoHorizontalScroll(client);
    await shot(client, 'offer-booking-summary', name());
    await client.getByRole('button', { name: 'Trimite cererea' }).click();
    await expect(client.getByRole('heading', { level: 1, name: 'Cerere trimisă' })).toBeVisible();
    await expect(client.getByText('-10% la manoperă', { exact: true })).toBeVisible();

    await client.getByRole('link', { name: 'Vezi programările' }).click();
    const booking = client.locator('li').filter({ hasText: shopName });
    await expect(booking).toContainText('Ofertă client nou: -10% la manoperă');
    await shot(client, 'offer-client-booking', name());

    // Not new any more: the card no longer promises it.
    await client.goto(`/c/cauta?q=${encodeURIComponent(shopName)}`);
    await expect(client.locator('article').filter({ hasText: shopName })).toBeVisible();
    await expect(client.locator('article').filter({ hasText: shopName })).not.toContainText('la prima programare');
    await clientContext.close();

    // ------------------------------------------------------------ the shop sees the promise
    await page.goto('/s/programari');
    const shopCard = page.locator('li').filter({ hasText: 'Skoda Octavia' });
    await expect(shopCard).toContainText('Client nou: i-ai promis -10% la manoperă');
    await expectNoHorizontalScroll(page);
    await shot(page, 'offer-shop-booking', name());

    // The car is in: the quote form reminds the shop to take the discount off.
    await serviceRest(`bookings?shop_id=eq.${shopId}`, 'PATCH', {
      status: 'in_inspection',
      confirmed_at: new Date().toISOString(),
      inspection_started_at: new Date().toISOString(),
    });
    await page.reload();
    await page.getByRole('tab', { name: /Programate/ }).click();
    await page.locator('li').filter({ hasText: 'Skoda Octavia' }).getByRole('button', { name: 'Trimite deviz' }).click();
    await expect(page.getByText('Scade reducerea din prețul manoperei înainte să trimiți devizul.', { exact: false })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 'offer-quote-form', name());

    // In English too.
    await serviceRest(`profiles?id=eq.${await userIdOf(shopEmail)}`, 'PATCH', { lang: 'en' });
    await page.reload();
    await expect(page.locator('li').filter({ hasText: 'Skoda Octavia' })).toContainText('New client: you promised 10% off labor');
    await page.goto('/s/cont/setari/reguli');
    const offerEn = page.getByRole('group', { name: 'New-client offer' });
    await expect(offerEn.getByRole('button', { name: '10% off', pressed: true })).toBeVisible();
    await offerEn.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 'offer-settings-en', name());
  });
});
