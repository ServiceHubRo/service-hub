import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  createUser,
  expectAccessible,
  expectNoHorizontalScroll,
  openAccount,
  serviceRest,
  shot,
  signIn,
  userIdOf,
} from './support';

// T39: the tour (a welcome, then one lit spot per main feature, "Sari peste") once per account,
// and "Primii pași": the shop's four numbered steps on Panou, the client's on Caută.

test.skip(!BACKEND, 'needs the local Supabase stack');
// These are the screens a brand-new account sees: the other tests switch them off.
test.use({ storageState: { cookies: [], origins: [] } });

const name = () => test.info().project.name;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
});

const tour = (page: Page) => page.getByRole('dialog');

/** The lit spot is around the element and the card is on screen. */
async function expectLit(page: Page, target: Locator) {
  // The light glides from spot to spot (CLAUDE.md §10): measure it once it has arrived.
  await page
    .locator('[data-tour-spot]')
    .evaluate((el) =>
      Promise.all(el.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished)),
    );
  const spot = (await page.locator('[data-tour-spot]').boundingBox())!;
  const box = (await target.boundingBox())!;
  // The light stays 4 px inside the screen (a sidebar item starts at its very edge).
  expect(spot.x).toBeLessThanOrEqual(Math.max(box.x, 4) + 1);
  expect(spot.y).toBeLessThanOrEqual(Math.max(box.y, 4) + 1);
  expect(spot.x + spot.width).toBeGreaterThanOrEqual(Math.min(box.x + box.width, page.viewportSize()!.width - 4) - 1);
  const card = (await tour(page).boundingBox())!;
  const view = page.viewportSize()!;
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(view.width);
  expect(card.y + card.height).toBeLessThanOrEqual(view.height);
}

/** The visible copy of a navigation item (bottom bar or sidebar). */
const navItem = (page: Page, path: string) => page.locator(`[data-tour="${path}"]`).filter({ visible: true }).first();

test('a new client: welcome, the lit spots one by one, "Primii pași" ticks itself, the tour once', async ({ page }) => {
  // Headless Chromium reports notifications as blocked: here the browser has not been asked yet.
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'default' });
  });
  const email = await createUser('client', {}, { onboarding: true });
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);

  await expect(tour(page)).toHaveAccessibleName('Bun venit, Maria');
  await expect(tour(page)).toContainText('Îți arătăm în câțiva pași unde găsești ce contează.');
  await expect(page.getByRole('button', { name: 'Începe' })).toBeFocused();
  await expectAccessible(page, 'tour welcome');
  await shot(page, 'tour-client-welcome', name());

  const stops: [string, string, Locator][] = [
    ['Primii pași', 'Câțiva pași și ești gata pentru prima programare.', page.locator('[data-tour="guide"]')],
    ['Caută un service', 'După reparație, nume sau oraș.', page.locator('#search-q')],
    ['Garaj', 'Mașinile tale, cu ITP, RCA și rovinieta la vedere.', navItem(page, '/c/garaj')],
    ['Programări', 'Programările tale și devizele de acceptat.', navItem(page, '/c/programari')],
    ['Mesaje', 'Vorbești direct cu service-ul.', navItem(page, '/c/mesaje')],
    ['Cont', 'Istoricul mașinilor, favoritele și setările.', navItem(page, '/c/cont')],
  ];
  await page.getByRole('button', { name: 'Începe' }).click();
  for (const [i, [title, body, target]] of stops.entries()) {
    await expect(tour(page)).toHaveAccessibleName(title);
    await expect(tour(page)).toContainText(`${i + 1} din ${stops.length}`);
    await expect(tour(page)).toContainText(body);
    await expectLit(page, target);
    if (i === 1) {
      // The page does not scroll under the tour: the light stays where it is.
      const before = await page.locator('[data-tour-spot]').boundingBox();
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(300);
      expect(await page.locator('[data-tour-spot]').boundingBox()).toEqual(before);
    }
    // A navigation item has no frame: it lights up itself.
    if (i >= 2) await expect(target).toHaveAttribute('data-tour-lit', '');
    if (i === 1 || i === 2) await shot(page, `tour-client-${i + 1}`, name());
    if (i < stops.length - 1) {
      await expect(page.getByRole('button', { name: 'Sari peste' })).toBeVisible();
      await page.getByRole('button', { name: 'Înainte' }).click();
    }
  }
  // The last one has no "Sari peste": "Gata" ends it, and the app can be used again. It does not
  // start over while the server takes its time to save it (on the internet, not instant).
  await expect(page.getByRole('button', { name: 'Sari peste' })).toHaveCount(0);
  await page.route('**/rest/v1/profiles?*', async (route) => {
    if (route.request().method() === 'PATCH') await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.getByRole('button', { name: 'Gata' }).click();
  await expect(tour(page)).toHaveCount(0);
  await page.waitForTimeout(2500);
  await expect(tour(page)).toHaveCount(0);
  await page.unroute('**/rest/v1/profiles?*');
  await expect(page.locator('[data-tour-lit]')).toHaveCount(0);
  const id = await userIdOf(email);
  await expect
    .poll(async () => (await serviceRest<{ tour_seen_at: string | null }[]>(`profiles?id=eq.${id}&select=tour_seen_at`, 'GET'))[0]!.tour_seen_at)
    .not.toBeNull();

  // "Primii pași": numbered, the next one lit; a car added elsewhere ticks the first.
  const guide = page.locator('[data-tour="guide"]');
  await expect(guide.getByRole('heading', { name: 'Primii pași' })).toBeVisible();
  await expect(guide).toContainText('0 din 3');
  await expect(guide.getByRole('link', { name: /Adaugă mașina/ })).toHaveAttribute('href', '/c/garaj/nou');
  await expect(guide.getByRole('button', { name: 'Activează' })).toBeVisible();
  await expect(guide).toContainText('Alege un service din listă.');
  // While it asks for notifications itself, the banner does not.
  await expect(page.getByText(/Activează notificările pentru/)).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await expectAccessible(page, 'client first steps');
  await shot(page, 'guide-client', name());
  await serviceRest('cars', 'POST', { owner_id: id, make: 'Dacia', model: 'Logan', year: 2019, plate: 'BV 39 TUR' });

  // Back on Caută: no tour again, the car ticked.
  await page.reload();
  await expect(page.locator('#search-q')).toBeVisible();
  await expect(guide).toContainText('1 din 3');
  await expect(guide.getByText('Adaugă mașina')).toHaveCSS('text-decoration-line', 'line-through');
  await page.waitForTimeout(1500);
  await expect(tour(page)).toHaveCount(0);

  // ✕ hides it for good.
  await page.getByRole('button', { name: 'Ascunde primii pași' }).click();
  await expect(guide).toHaveCount(0);
  await expect(page.getByText(/Activează notificările pentru/)).toBeVisible();
  await page.reload();
  await expect(page.locator('#search-q')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(guide).toHaveCount(0);

  // The tour again, from Ajutor și contact; Escape ends it.
  await openAccount(page);
  await page.getByRole('link', { name: /^Ajutor și contact/ }).click();
  await page.getByRole('link', { name: /^Turul aplicației/ }).click();
  await expect(page).toHaveURL(/\/c\/cauta/);
  await expect(tour(page)).toHaveAccessibleName('Bun venit, Maria');
  await page.getByRole('button', { name: 'Începe' }).click();
  await expect(tour(page)).toHaveAccessibleName('Caută un service');
  await expect(tour(page)).toContainText('1 din 5');
  await page.keyboard.press('Escape');
  await expect(tour(page)).toHaveCount(0);
});

test('a new shop, in English: the tour skipped at the second spot, the four numbered steps', async ({ page }) => {
  const email = await createUser('shop', { lang: 'en' }, { onboarding: true });
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/s\/panou$/);

  await expect(tour(page)).toHaveAccessibleName('Welcome, Ion');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(tour(page)).toHaveAccessibleName('First steps');
  await expect(tour(page)).toContainText('1 of 6');
  await expect(tour(page)).toContainText('Four steps and your shop shows up in search.');
  await expectLit(page, page.locator('[data-tour="guide"]'));
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(tour(page)).toHaveAccessibleName('Dashboard');
  await expectLit(page, page.locator('[data-tour="dashboard"]'));
  await expectAccessible(page, 'shop tour (en)');
  await shot(page, 'tour-shop-dashboard', name());
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(tour(page)).toHaveCount(0);

  // The steps on Panou: numbered, the first one next, "0 of 4".
  const guide = page.locator('[data-tour="guide"]');
  await expect(guide).toContainText('0 of 4');
  await expect(guide.getByRole('link', { name: /Choose the services you offer/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'guide-shop', name());

  await page.reload();
  await expect(page.locator('[data-tour="dashboard"]')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(tour(page)).toHaveCount(0);
});
