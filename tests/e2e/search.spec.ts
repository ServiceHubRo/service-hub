import { expect, test, type Page } from '@playwright/test';
import { BACKEND, PASSWORD, createUser, expectNoHorizontalScroll, openAccount, scrollTopOf, shot, signIn } from './support';

// T06 — client search, favorites, "Aproape de tine", the shop page. Runs on the demo seed
// (supabase/seed/dev_seed.sql): Atelier Demo, Rapid Service, Vulcanizare Roți Expres (Brașov) and
// Auto Precis (Codlea). Every test signs up its own client, so favorites never collide.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

const name = () => test.info().project.name;

/** A result card's link, by shop name. */
const result = (page: Page, shop: string) => page.getByRole('link', { name: new RegExp(`^${shop}`) });
const search = (page: Page) => page.getByLabel('Caută un service');

async function signInNewClient(page: Page) {
  const email = await createUser('client');
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();
  return email;
}

test.describe('client search', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('name, city and service without diacritics; chips combine; empty state clears the filters', async ({ page }) => {
    await signInNewClient(page);
    await expect(result(page, 'Atelier Demo')).toBeVisible();
    await expect(result(page, 'Auto Precis')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Codlea', exact: true })).toBeVisible(); // city chips from the data
    await expectNoHorizontalScroll(page);
    await shot(page, 't06-search', name());

    // "frane" finds the brake service and says so.
    await search(page).fill('frane');
    await expect(result(page, 'Vulcanizare Roți Expres')).toHaveCount(0);
    await expect(result(page, 'Atelier Demo')).toContainText('Oferă: Plăcuțe de frână');
    await expect(result(page, 'Auto Precis')).toContainText('Oferă: Plăcuțe de frână');
    await shot(page, 't06-search-frane', name());

    // Typing a city selects its chip.
    await search(page).fill('brasov');
    await expect(page.getByRole('button', { name: 'Brașov', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(result(page, 'Auto Precis')).toHaveCount(0);
    await expect(result(page, 'Atelier Demo')).not.toContainText('Oferă');
    await expect(page.getByText(/service-uri în Brașov/)).toBeVisible();

    // Clearing the text undoes the chip it picked.
    await page.getByRole('button', { name: 'Șterge căutarea' }).click();
    await expect(page.getByRole('button', { name: 'Toate orașele' })).toHaveAttribute('aria-pressed', 'true');

    // Category, then category + city: filters combine and narrow.
    await page.getByRole('button', { name: 'Anvelope & Jante' }).click();
    await expect(result(page, 'Vulcanizare Roți Expres')).toContainText('Oferă: Vulcanizare / reparație pană');
    await expect(result(page, 'Atelier Demo')).toHaveCount(0);
    await page.getByRole('button', { name: 'Codlea', exact: true }).click();
    await expect(page.getByText('Niciun service cu filtrele alese.')).toBeVisible();
    await shot(page, 't06-search-empty', name());
    await page.getByRole('button', { name: 'Șterge filtrele' }).last().click();
    await expect(result(page, 'Auto Precis')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Toate', exact: true })).toHaveAttribute('aria-pressed', 'true');

    // Two words: a service and a city.
    await search(page).fill('frane codlea');
    await expect(result(page, 'Auto Precis')).toBeVisible();
    await expect(result(page, 'Atelier Demo')).toHaveCount(0);

    // Nothing at all.
    await search(page).fill('zzzz');
    await expect(page.getByText('Niciun service pentru „zzzz”.')).toBeVisible();

    // The order explained.
    await page.getByRole('button', { name: 'Cum e ordonată lista?' }).click();
    await expect(page.getByText(/Nimeni nu plătește ca să apară mai sus/)).toBeVisible();

    // The filters live in the address: a reload keeps them.
    await page.reload();
    await expect(search(page)).toHaveValue('zzzz');
  });

  test('favorites: heart on the card and on the shop page, the Favorite chip, the list in Cont', async ({ page }) => {
    await signInNewClient(page);
    // The heart saves in place: the list does not jump.
    const heart = page.getByRole('button', { name: 'Salvează Rapid Service la favorite' });
    await heart.scrollIntoViewIfNeeded();
    const before = await scrollTopOf(page);
    await heart.click();
    expect(await scrollTopOf(page)).toBe(before);
    await expect(page.getByRole('button', { name: 'Scoate Rapid Service din favorite' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Favorite', exact: true }).click();
    await expect(result(page, 'Rapid Service')).toBeVisible();
    await expect(result(page, 'Atelier Demo')).toHaveCount(0);

    // Shop page: the same heart.
    await page.getByRole('button', { name: 'Favorite', exact: true }).click();
    await result(page, 'Atelier Demo').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Atelier Demo' })).toBeVisible();
    await page.getByRole('button', { name: 'Salvează Atelier Demo la favorite' }).click();
    await expect(page.getByRole('button', { name: 'Scoate Atelier Demo din favorite' })).toBeVisible();

    await openAccount(page);
    await page.getByRole('link', { name: /Favorite/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Favorite' })).toBeVisible();
    await expect(result(page, 'Rapid Service')).toBeVisible();
    await expect(result(page, 'Atelier Demo')).toBeVisible();
    await expect(page.getByText('2 service-uri')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't06-favorites', name());

    // Back from a shop page returns to the list it came from.
    await result(page, 'Rapid Service').click();
    await page.getByRole('link', { name: 'Favorite' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Favorite' })).toBeVisible();
  });

  test('shop page: hours, rules, phone, services, fee, reviews with replies; no fiscal data', async ({ page }) => {
    await signInNewClient(page);
    await search(page).fill('frane');
    await result(page, 'Atelier Demo').click();
    await expect(page).toHaveURL(/\/c\/service\//);
    await expect(page.getByRole('heading', { level: 1, name: 'Atelier Demo' })).toBeVisible();
    await expect(page.getByText('Str. Lungă 42, Brașov')).toBeVisible();
    await expect(page.getByText('Lun – Vin')).toBeVisible();
    await expect(page.getByText('08:00 – 18:00')).toBeVisible();
    await expect(page.getByText('Închis temporar')).toBeVisible();
    await expect(page.getByText('Concediu')).toBeVisible();
    await expect(page.getByText('cu cel puțin 2 ore înainte')).toBeVisible();
    await expect(page.getByRole('link', { name: /Sună la Atelier Demo/ })).toHaveAttribute('href', /^tel:\+?\d+$/);
    await expect(page.getByText('80 lei')).toBeVisible();
    await expect(page.getByText('Se percepe doar dacă refuzi devizul după verificare.')).toBeVisible();
    await expect(page.getByText('Plăcuțe de frână')).toBeVisible();
    await expect(page.getByText('Prețul se stabilește prin deviz, după ce service-ul vede mașina.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recenzii' })).toBeVisible();
    await expect(page.getByText('Răspunsul service-ului')).toBeVisible();
    // Fiscal data never reaches the client.
    await expect(page.getByText(/RO14872301|AUTO DEMO SERV|RO49AAAA|J08\/1245/)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, 't06-shop-page', name());

    // Back keeps the search.
    await page.getByRole('link', { name: 'Toate service-urile' }).click();
    await expect(search(page)).toHaveValue('frane');

    // "Programează-te" opens the first of the 4 booking steps (T07).
    await result(page, 'Atelier Demo').click();
    await page.getByRole('link', { name: 'Programează-te' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ce ai nevoie?' })).toBeVisible();

    // A shop without reviews has no review section.
    await page.goto('/c/cauta?q=vulcanizare');
    await result(page, 'Vulcanizare Roți Expres').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Vulcanizare Roți Expres' })).toBeVisible();
    await expect(page.getByText('Fără recenzii încă')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recenzii' })).toHaveCount(0);

    // An unknown shop.
    await page.goto('/c/service/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('Service-ul nu mai e disponibil.')).toBeVisible();
  });

  test.describe('with the location already allowed in the browser', () => {
    test.use({ permissions: ['geolocation'], geolocation: { latitude: 45.6427, longitude: 25.5887 } }); // Brașov centre

    test('"Aproape de tine", distances on the cards, nearest first; no banner', async ({ page }) => {
      await signInNewClient(page);
      await expect(page.getByRole('heading', { name: 'Aproape de tine' })).toBeVisible();
      await expect(result(page, 'Atelier Demo').first()).toContainText('0,2 km');
      await expect(result(page, 'Auto Precis').first()).toContainText('13 km');
      await expect(page.getByText('Activează locația ca să vezi service-urile din apropiere.')).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      await shot(page, 't06-search-near', name());

      // "Cele mai apropiate" is a sort; the section is not repeated.
      await page.getByRole('button', { name: 'Cele mai apropiate' }).click();
      await expect(page.getByRole('heading', { name: 'Aproape de tine' })).toHaveCount(0);
      const cards = await page.getByRole('article').allInnerTexts();
      const at = (shop: string) => cards.findIndex((c) => c.includes(shop));
      expect(at('Atelier Demo')).toBeGreaterThanOrEqual(0);
      expect(at('Atelier Demo')).toBeLessThan(at('Auto Precis')); // 0,2 km before 13 km, whatever the rating

      // Distance on the shop page too; Cont shows the location on.
      await result(page, 'Atelier Demo').click();
      await expect(page.getByText('la 0,2 km')).toBeVisible();
      await openAccount(page);
      await expect(page.getByText(/Pornită\. Vezi distanțele în căutare/)).toBeVisible();
    });
  });

  test('"Nu acum" hides the location banner for good', async ({ page }) => {
    await signInNewClient(page);
    // Asked in the app first; the browser's own prompt only after "Activează".
    await expect(page.getByText('Activează locația ca să vezi service-urile din apropiere.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Aproape de tine' })).toHaveCount(0);
    const saved = page.waitForResponse((r) => r.url().includes('/rest/v1/profiles') && r.request().method() === 'PATCH');
    await page.getByRole('region', { name: 'Locație' }).getByRole('button', { name: 'Nu acum' }).click();
    await expect(page.getByText('Activează locația ca să vezi service-urile din apropiere.')).toHaveCount(0);
    expect((await saved).ok()).toBe(true);
    // Saved on the profile: a new visit does not ask again.
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();
    await expect(result(page, 'Atelier Demo')).toBeVisible();
    await expect(page.getByText('Activează locația ca să vezi service-urile din apropiere.')).toHaveCount(0);
    // It can still be turned on from Cont.
    await openAccount(page);
    await expect(page.getByText('Locație', { exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Locație' }).getByRole('button', { name: 'Activează' })).toBeVisible();
  });

  test('English: search, "Offers", the shop page', async ({ page }) => {
    await signInNewClient(page);
    await page.getByRole('button', { name: 'English' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
    await page.getByLabel('Search for a shop').fill('brakes');
    await expect(result(page, 'Atelier Demo')).toContainText('Offers: Brake pads');
    await result(page, 'Atelier Demo').click();
    await expect(page.getByText('Services offered')).toBeVisible();
    await expect(page.getByText('80 RON')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Book now' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't06-shop-page-en', name());
  });
});
