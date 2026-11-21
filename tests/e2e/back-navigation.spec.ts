import { expect, test, type Page } from '@playwright/test';
import { BACKEND, PASSWORD, SEED, SEED_PASSWORD, createUser, expectNoHorizontalScroll, signIn } from './support';

// C11 audit (Eduard, 21 Nov 2026): „Înapoi” leads where the reader came from, on every screen that opens
// another — beside a list (from 1024 px) and on a phone. Runs on the demo seed (Atelier Demo, Rapid Service,
// Vulcanizare Roți Expres, Auto Precis); every test signs up its own client.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

const wideOf = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;
const shopHeader = (page: Page) => page.locator('[data-ui="shop-header"]');

async function signInSeed(page: Page) {
  // The shared demo client: its saved language is never rewritten from here.
  await page.route('**/rest/v1/profiles?*', (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue()));
  await signIn(page, SEED.client, SEED_PASSWORD);
  await expect(page).not.toHaveURL(/\/intra/);
}

async function signInNewClient(page: Page) {
  const email = await createUser('client');
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta$/);
  return email;
}

/** The results for `q` have arrived (until then the previous list shows, dimmed). */
async function searchFor(page: Page, q: string) {
  await page.getByLabel('Caută un service').fill(q);
  await expect(page).toHaveURL(/[?&]q=/);
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
}

/** Opens a shop from its card: on a phone its page, from 1024 px beside the results. */
async function openShop(page: Page, shop: string) {
  await page.getByRole('link', { name: new RegExp(`^${shop}`) }).getByText(shop, { exact: true }).first().click();
  await expect(wideOf(page) ? shopHeader(page).getByRole('heading', { name: shop }) : page.getByRole('heading', { level: 1, name: shop })).toBeVisible();
}

/** What stands as the shop in view: the card marked current beside the results. */
const currentCard = (page: Page) => page.locator('article[aria-current="true"]');

test.describe('Back goes where the reader came from', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('search → a shop → its services → Back: the search, the shop still chosen', async ({ page }) => {
    await signInNewClient(page);
    await searchFor(page, 'frane');
    await openShop(page, 'Atelier Demo');
    if (wideOf(page)) await expect(currentCard(page)).toContainText('Atelier Demo');
    await page.getByRole('link', { name: /^Servicii oferite/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Servicii oferite' })).toBeVisible();
    // The first category is open beside the list; on a phone the list comes first.
    if (!wideOf(page)) await page.locator('[data-back-bar]').first().isVisible().catch(() => false);
    await page.getByRole('link', { name: wideOf(page) ? 'Toate service-urile' : 'Atelier Demo' }).first().click();
    if (wideOf(page)) {
      await expect(page).toHaveURL(/\/c\/cauta\?/);
      await expect(page.getByLabel('Caută un service')).toHaveValue('frane');
      await expect(currentCard(page)).toContainText('Atelier Demo');
    } else {
      await expect(page.getByRole('heading', { level: 1, name: 'Atelier Demo' })).toBeVisible();
      await page.getByRole('link', { name: 'Toate service-urile' }).click();
      await expect(page.getByLabel('Caută un service')).toHaveValue('frane');
    }
    await expectNoHorizontalScroll(page);
  });

  test('search → a shop → its reviews → Back: the search', async ({ page }) => {
    await signInNewClient(page);
    await searchFor(page, 'frane');
    await openShop(page, 'Atelier Demo');
    await shopHeader(page).getByRole('link', { name: /recenzi/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Recenzii' })).toBeVisible();
    await page.getByRole('link', { name: wideOf(page) ? 'Toate service-urile' : 'Atelier Demo' }).first().click();
    if (wideOf(page)) {
      await expect(page.getByLabel('Caută un service')).toHaveValue('frane');
      await expect(currentCard(page)).toContainText('Atelier Demo');
    } else {
      await expect(page.getByRole('heading', { level: 1, name: 'Atelier Demo' })).toBeVisible();
    }
  });

  test('search → a shop → Programează-te → Back (step 1): the search; Back from step 2: step 1', async ({ page }) => {
    await signInNewClient(page);
    await searchFor(page, 'frane');
    await openShop(page, 'Atelier Demo');
    await page.getByRole('link', { name: 'Programează', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ce ai nevoie?' })).toBeVisible();
    // One service, on to the day, and Back to the services: what was ticked is kept.
    await page.getByRole('button', { name: /^(Schimb ulei|Plăcuțe de frână)/ }).first().click();
    await page.getByRole('button', { name: /^Continuă/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Alege ziua' })).toBeVisible();
    await page.getByRole('link', { name: 'Înapoi' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ce ai nevoie?' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Continuă · 1 serviciu/ })).toBeVisible();
    // Back from step 1 leaves the booking for where the shop was opened from: the search beside the results
    // (from 1024 px), the shop's page on a phone — and from there the search.
    if (wideOf(page)) {
      await page.getByRole('link', { name: 'Toate service-urile' }).first().click();
    } else {
      await page.getByRole('link', { name: 'Înapoi la service' }).first().click();
      await expect(page.getByRole('heading', { level: 1, name: 'Atelier Demo' })).toBeVisible();
      await page.getByRole('link', { name: 'Toate service-urile' }).click();
    }
    await expect(page.getByLabel('Caută un service')).toHaveValue('frane');
    if (wideOf(page)) await expect(currentCard(page)).toContainText('Atelier Demo');
  });

  test('a shop page opened by its address: Back from its services goes to the shop page', async ({ page }) => {
    await signInNewClient(page);
    await searchFor(page, 'frane');
    // On a phone a card opens the page; from 1024 px it shows beside the results, so go by the address.
    const href = await page.getByRole('link', { name: /^Atelier Demo/ }).first().getAttribute('href');
    await page.goto(href!);
    await expect(page.getByRole('heading', { level: 1, name: 'Atelier Demo' })).toBeVisible();
    await page.getByRole('link', { name: /^Servicii oferite/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Servicii oferite' })).toBeVisible();
    await page.getByRole('link', { name: 'Atelier Demo' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Atelier Demo' })).toBeVisible();
  });

  test('Mesaje: a conversation chosen, then another; the browser Back goes through them', async ({ page }) => {
    await signInSeed(page);
    await page.goto('/c/mesaje');
    await expect(page.getByRole('heading', { level: 1, name: 'Mesaje' })).toBeVisible();
    const rows = page.locator('main a[href^="/c/mesaje/"]:not([href$="/echipa"])');
    await expect(rows.first()).toBeVisible();
    // Nothing opens by itself beside the list: opening a conversation reads it.
    if (wideOf(page)) await expect(page.locator('[data-ui="detail-frame"]')).toContainText('Alege o conversație.');
    await rows.first().click();
    await expect(page).toHaveURL(/\/c\/mesaje\/[0-9a-f-]{36}$/);
    if (wideOf(page)) {
      await expect(page.locator('[data-ui="detail-frame"]').getByRole('heading', { level: 2 }).first()).toBeVisible();
      await rows.nth(1).click();
      await expect(page).toHaveURL(/\/c\/mesaje\/[0-9a-f-]{36}$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/c\/mesaje\/[0-9a-f-]{36}$/);
    }
    await page.goBack();
    await expect(page).toHaveURL(/\/c\/mesaje$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Mesaje' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('Garaj: a car opened for editing, closed; the history of a car and Back', async ({ page }) => {
    await signInSeed(page);
    await page.goto('/c/garaj');
    await expect(page.getByRole('heading', { level: 1, name: 'Garaj' })).toBeVisible();
    await page.getByRole('link', { name: /^Editează/ }).first().click();
    await expect(page).toHaveURL(/\/c\/garaj\/[0-9a-f-]{36}$/);
    if (wideOf(page)) {
      // Beside the cards; the list stays, the panel closes with its „×”.
      await expect(page.locator('[data-ui="detail-frame"]')).toBeVisible();
      await page.getByRole('link', { name: 'Închide' }).click();
      await expect(page).toHaveURL(/\/c\/garaj$/);
      await expect(page.locator('[data-ui="detail-frame"]')).toContainText('Alege istoricul, raportul sau editarea unei mașini.');
    } else {
      await page.locator('[data-back-bar] a').first().click();
      await expect(page).toHaveURL(/\/c\/garaj$/);
    }
    // The history of the first car with jobs, then the browser Back to the garage.
    const history = page.getByRole('link', { name: /^Istoric — [1-9]/ }).first();
    await history.click();
    await expect(page).toHaveURL(/\/istoric$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/c\/garaj$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Garaj' })).toBeVisible();
  });

  test('Favorite: a shop chosen, its reviews, Back: the favorites with the shop still chosen', async ({ page }) => {
    await signInNewClient(page);
    await searchFor(page, 'frane');
    await openShop(page, 'Atelier Demo');
    if (wideOf(page)) await shopHeader(page).getByRole('button', { name: 'Salvează Atelier Demo la favorite' }).click();
    else await page.getByRole('button', { name: 'Salvează Atelier Demo la favorite' }).click();
    await page.getByRole('link', { name: /^Cont/ }).filter({ visible: true }).first().click();
    await page.getByRole('link', { name: /Favorite/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Favorite' })).toBeVisible();
    if (wideOf(page)) {
      await expect(page.locator('[data-ui="shop-header"]').getByRole('heading', { name: 'Atelier Demo' })).toBeVisible();
      await shopHeader(page).getByRole('link', { name: /recenzi/ }).click();
    } else {
      await page.getByRole('link', { name: /^Atelier Demo/ }).getByText('Atelier Demo', { exact: true }).first().click();
      await page.getByRole('link', { name: /recenzi/ }).first().click();
    }
    await expect(page.getByRole('heading', { level: 1, name: 'Recenzii' })).toBeVisible();
    await page.getByRole('link', { name: wideOf(page) ? 'Favorite' : 'Atelier Demo' }).first().click();
    if (wideOf(page)) {
      await expect(page.getByRole('heading', { level: 1, name: 'Favorite' })).toBeVisible();
      await expect(page.locator('[data-ui="shop-header"]').getByRole('heading', { name: 'Atelier Demo' })).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { level: 1, name: 'Atelier Demo' })).toBeVisible();
    }
  });

  test('programare, step 4 (laptop): „Schimbă serviciile” goes to step 1 with what was ticked, then forward again', async ({ page }) => {
    test.skip(!wideOf(page), '„Schimbă …” is the laptop layout of step 4');
    await signInNewClient(page);
    await searchFor(page, 'frane');
    await openShop(page, 'Atelier Demo');
    await page.getByRole('link', { name: 'Programează', exact: true }).click();
    await page.getByRole('button', { name: /^Schimb ulei/ }).first().click();
    await page.getByRole('button', { name: /^Continuă/ }).click();
    await page.getByRole('button', { name: /: \d+ loc/ }).first().click();
    await page.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mașina' })).toBeVisible();
    await page.getByRole('button', { name: 'Schimbă serviciile' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ce ai nevoie?' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Continuă · 1 serviciu/ })).toBeVisible();
    await page.getByRole('button', { name: /^Continuă/ }).click();
    // The day and the time were kept: straight to the car.
    await expect(page.getByRole('heading', { level: 1, name: 'Mașina' })).toBeVisible();
  });
});
