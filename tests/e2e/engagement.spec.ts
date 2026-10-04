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
  serviceRest,
  shot,
  signIn,
  userIdOf,
} from './support';

// T24 — the switches for the new notifications: the client's tires and tips in Cont, the owner's
// monthly report in Setări → Notificări, the quiet hours and weekly tips in the admin's settings,
// and where a tap on the tire reminder leads. (The pushes themselves, sent by the jobs, are
// covered by tests/sql/101_engagement.sql.)

const name = () => test.info().project.name;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

async function setLanguage(page: Page, lang: 'ro' | 'en') {
  await page.getByRole('link', { name: lang === 'en' ? 'Cont' : 'Account', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: lang === 'en' ? 'English' : 'Română' }).filter({ visible: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: lang === 'en' ? 'Account' : 'Cont' })).toBeVisible();
}

test.describe('T24 notifications', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(90_000);

  test('Cont: seasonal tires on, offers off until turned on, saved on the account; no switch for the tips', async ({ page }) => {
    const client = await createUser('client');
    await signIn(page, client, PASSWORD);
    await openAccount(page);
    const tires = page.getByRole('group', { name: 'Anvelopele de sezon' });
    const tips = page.getByRole('group', { name: 'Sfaturi pentru început' });
    const offers = page.getByRole('group', { name: 'Ofertele service-urilor favorite' });
    await expect(tires).toContainText('Pornite.');
    await expect(tips).toHaveCount(0);
    await expect(offers).toContainText('Oprite.');
    await offers.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 't24-account-reminders', name());

    await tires.getByRole('button', { name: 'Oprește' }).click();
    await expect(tires).toContainText('Oprite.');
    await offers.getByRole('button', { name: 'Pornește' }).click();
    await expect(offers).toContainText('Pornite.');
    const [profile] = await serviceRest<{ season_reminders: boolean; app_tips: boolean; promo_notifications: boolean; service_reminders: boolean }[]>(
      `profiles?id=eq.${await userIdOf(client)}&select=season_reminders,app_tips,promo_notifications,service_reminders`,
      'GET',
    );
    expect(profile).toEqual({ season_reminders: false, app_tips: true, promo_notifications: true, service_reminders: true });

    await page.reload();
    await expect(tires).toContainText('Oprite.');
    await setLanguage(page, 'en');
    const tiresEn = page.getByRole('group', { name: 'Seasonal tires' });
    await expect(tiresEn).toContainText('Off.');
    const offersEn = page.getByRole('group', { name: 'Favorite shops’ offers' });
    await expect(offersEn).toContainText('On.');
    await offersEn.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 't24-account-reminders-en', name());
    await tiresEn.getByRole('button', { name: 'Turn on' }).click();
    await expect(tiresEn).toContainText('On.');
  });

  test('a tap on the tire reminder opens the tire shops', async ({ page }) => {
    const shopName = `Vulcanizare T24 ${Date.now()}`;
    await createBookableShop(shopName, ['anvelope']);
    const client = await createUser('client');
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    // The address the tire_season push opens when no shop changed the tires before.
    await page.goto('/c/cauta?cat=cat_anv');
    await expect(page.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();
    await expect(page.getByText(shopName)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't24-tire-search', name());
  });

  test('Setări → Notificări: the owner turns the monthly report off', async ({ page }) => {
    const { email: owner, shopId } = await createBookableShop(`Atelier T24 ${Date.now()}`, ['ulei']);
    await signIn(page, owner, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou/);
    await page.goto('/s/cont/setari/notificari');
    await expect(page.getByRole('heading', { level: 1, name: 'Notificări' })).toBeVisible();
    const monthly = page.getByRole('checkbox', { name: 'Raportul lunii, pe 1 ale lunii' });
    await expect(monthly).toBeChecked();
    await expectNoHorizontalScroll(page);
    await shot(page, 't24-shop-notifications', name());

    await monthly.uncheck();
    await page.getByRole('button', { name: 'Salvează notificările' }).click();
    await expect(page.getByRole('button', { name: '✓ Salvat' })).toBeVisible();
    const [shop] = await serviceRest<{ monthly_report: boolean }[]>(`shops?id=eq.${shopId}&select=monthly_report`, 'GET');
    expect(shop!.monthly_report).toBe(false);

    await page.reload();
    await expect(monthly).not.toBeChecked();
    await setLanguage(page, 'en');
    await page.goto('/s/cont/setari/notificari');
    await expect(page.getByRole('checkbox', { name: 'Monthly report, on the 1st' })).not.toBeChecked();
    await expectNoHorizontalScroll(page);
    await shot(page, 't24-shop-notifications-en', name());
  });

  test('admin: quiet hours and tips a week in Setări platformă', async ({ page }) => {
    // The demo admin is shared by tests running in parallel: its saved language never changes.
    await page.route('**/rest/v1/profiles?*', (route) =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue(),
    );
    await signIn(page, SEED.admin, SEED_PASSWORD);
    await expect(page.getByRole('heading', { level: 1, name: 'Panou principal' })).toBeVisible();
    await openAccount(page);
    await page.getByRole('link', { name: /^Setări platformă/ }).click();
    const section = page.getByRole('region', { name: 'Notificări automate' });
    await expect(section.getByLabel('Ore de liniște: de la ora')).toHaveValue(/^\d+$/);
    await expect(section.getByLabel('Ore de liniște: până la ora')).toHaveValue(/^\d+$/);
    await expect(section.getByLabel('Sfaturi și oferte pe săptămână')).toHaveValue(/^\d+$/);
    await section.getByLabel('Sfaturi și oferte pe săptămână').scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 't24-admin-settings', name());

    // An hour that does not exist is refused by the database, and named.
    await section.getByLabel('Ore de liniște: de la ora').fill('25');
    await page.getByRole('button', { name: 'Salvează setările' }).click();
    await expect(page.getByRole('alert').filter({ visible: true }).first()).toBeVisible();
    await shot(page, 't24-admin-settings-error', name());
  });
});
