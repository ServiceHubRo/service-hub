import { expect, test, type Page } from '@playwright/test';
import {
  BACKEND,
  SEED,
  SEED_PASSWORD,
  expectAccessible,
  expectNoHorizontalScroll,
  expectNoRomanianText,
  serviceRest,
  signIn,
} from './support';

// T18: every screen of every role passes the WCAG 2.1 AA checks (axe-core) and has 44 px tap
// targets, in Romanian and English; keyboard users can skip the navigation. Read-only visits of
// the demo accounts (conversations are not opened: that would mark them read for other tests).
// T19c (launch check): on the same visit, nothing sticks out sideways at 390 / 820 / 1440 px and
// no Romanian text is left on an English screen.

test.skip(!BACKEND, 'needs the local Supabase stack');
// Many screens per test.
test.setTimeout(180_000);

async function seedId(path: string): Promise<string> {
  const rows = await serviceRest<{ id: string }[]>(path, 'GET');
  expect(rows.length, path).toBeGreaterThan(0);
  return rows[0]!.id;
}

/** Opens a screen and waits until it has loaded (no skeletons, no spinner). */
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
}

/** Signs in as a demo account and shows the app in `lang` (the profile's language wins in the app). */
async function signInAs(page: Page, email: string, lang: 'ro' | 'en') {
  // The demo accounts are shared: their saved language is only rewritten in this browser.
  await page.route('**/rest/v1/profiles?*', async (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ status: 204 });
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as unknown;
    const withLang = (row: unknown) => (row && typeof row === 'object' && 'lang' in row ? { ...row, lang } : row);
    return route.fulfill({ response, json: Array.isArray(body) ? body.map(withLang) : withLang(body) });
  });
  await page.context().addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
  await signIn(page, email, SEED_PASSWORD);
  await expect(page).not.toHaveURL(/\/intra/);
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
}

async function checkAll(page: Page, lang: 'ro' | 'en', paths: string[]) {
  for (const path of paths) {
    await open(page, path);
    await expectAccessible(page, `${path} (${lang})`);
    await expectNoHorizontalScroll(page);
    if (lang === 'en') await expectNoRomanianText(page, path);
  }
}

for (const lang of ['ro', 'en'] as const) {
  test(`client screens are accessible (${lang})`, async ({ page }) => {
    const shopId = await seedId('shops?name=eq.Atelier%20Demo&select=id');
    const carId = await seedId('cars?select=id&order=created_at.asc&limit=1');
    await signInAs(page, SEED.client, lang);
    await checkAll(page, lang, [
      '/c/cauta',
      `/c/service/${shopId}`,
      `/c/service/${shopId}/programare`,
      '/c/garaj',
      '/c/garaj/nou',
      `/c/garaj/${carId}`,
      `/c/garaj/${carId}/istoric`,
      '/c/programari',
      '/c/mesaje',
      '/c/cont',
      '/c/cont/favorite',
      '/c/cont/istoric',
      '/c/cont/rapoarte',
      '/c/cont/legal/termeni',
      '/c/nu-exista',
    ]);
  });

  test(`shop screens are accessible (${lang})`, async ({ page }) => {
    await signInAs(page, SEED.shop, lang);
    await checkAll(page, lang, [
      '/s/panou',
      '/s/programari',
      '/s/programari?tab=programate',
      '/s/istoric',
      '/s/mesaje',
      '/s/cont',
      '/s/cont/setari',
      '/s/cont/setari/profil',
      '/s/cont/setari/program',
      '/s/cont/setari/reguli',
      '/s/cont/setari/servicii',
      '/s/cont/setari/facturare',
      '/s/cont/setari/personal',
      '/s/cont/setari/notificari',
      '/s/cont/recenzii',
      '/s/cont/abonament',
      '/s/cont/rapoarte',
    ]);
  });

  test(`admin screens are accessible (${lang})`, async ({ page }) => {
    const shopId = await seedId('shops?name=eq.Atelier%20Demo&select=id');
    const bookingId = await seedId('bookings?select=id&order=created_at.asc&limit=1');
    const clientId = await seedId('profiles?role=eq.client&select=id&order=created_at.asc&limit=1');
    await signInAs(page, SEED.admin, lang);
    await checkAll(page, lang, [
      '/admin/prezentare',
      '/admin/service-uri',
      `/admin/service-uri/${shopId}`,
      '/admin/clienti',
      `/admin/clienti/${clientId}`,
      '/admin/rezervari',
      `/admin/rezervari/${bookingId}`,
      '/admin/moderare',
      '/admin/cont',
      '/admin/cont/jurnal',
      '/admin/cont/abonamente',
      '/admin/cont/rapoarte',
      '/admin/cont/catalog',
      '/admin/cont/setari',
      '/admin/cont/setari/texte',
      '/admin/cont/anunturi',
      '/admin/cont/export',
    ]);
  });
}

test('keyboard only: sign in, skip the navigation, open a tab', async ({ page }) => {
  await page.context().addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
  await page.goto('/intra');
  const email = page.getByLabel('Email');
  await email.focus();
  await page.keyboard.type(SEED.shop);
  await page.keyboard.press('Tab');
  await page.keyboard.type(SEED_PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/s\/panou$/);
  await expect(page).toHaveTitle('Panou · Service-Hub');

  // The first Tab shows "Sari la conținut"; Enter moves focus to the screen, past the navigation.
  await page.locator('body').focus();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Sari la conținut' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();

  // Tab from the screen reaches the navigation too; Enter opens Istoric.
  const history = page.getByRole('link', { name: /^Istoric/ }).filter({ visible: true }).first();
  for (let i = 0; i < 80 && !(await history.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(history).toBeFocused();
  expect(await history.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('rgb(245, 165, 36)');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/s\/istoric$/);
  await expect(page).toHaveTitle('Istoric · Service-Hub');
});
