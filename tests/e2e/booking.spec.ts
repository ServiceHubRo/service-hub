import { expect, test, type Page } from '@playwright/test';
import { formatDate } from '../../src/i18n/format';
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

// T07 — the garage with its expiry alerts, the 4-step booking, capacity, a day that fills up while
// the screen is open, the unconfirmed-email rule, and the client's Programări list.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

const name = () => test.info().project.name;

/** YYYY-MM-DD, n days from today (Bucharest). */
function inDays(n: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(new Date(Date.now() + n * 86_400_000));
}

const navLink = (page: Page, label: string) => page.getByRole('link', { name: label, exact: true }).filter({ visible: true }).first();

async function signInClient(page: Page, lang: 'ro' | 'en' = 'ro') {
  const email = await createUser('client', { lang });
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta$/);
  return email;
}

/** The chosen day and time, read from the address (`?zi=…&ora=…`). */
function choice(page: Page): { day: string; time: string } {
  const url = new URL(page.url());
  return { day: url.searchParams.get('zi') ?? '', time: url.searchParams.get('ora') ?? '' };
}

test.describe('garage', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('add a car with ITP soon: pills and the Caută banner; edit; delete with confirmation', async ({ page }) => {
    await signInClient(page);
    await navLink(page, 'Garaj').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Garaj' })).toBeVisible();
    await expect(page.getByText('Nicio mașină salvată.')).toBeVisible();
    await shot(page, 't07-garage-empty', name());

    await page.getByRole('link', { name: 'Adaugă mașină' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mașină nouă' })).toBeVisible();
    const save = page.getByRole('button', { name: 'Salvează' });
    await expect(save).toBeDisabled(); // make and model first
    await page.getByLabel('Marcă').fill('Volkswagen');
    await page.getByLabel('Model').fill('Golf 7');
    await page.getByLabel('An fabricație').fill('2016');
    await page.getByLabel('Nr. înmatriculare').fill('bv 12 abc');
    // A wrong VIN is refused with a reason; the page stays where it is.
    await page.getByLabel(/Serie de șasiu/).fill('WVWZZZ');
    await page.getByLabel(/ITP/).click();
    await expect(page.getByText('Seria de șasiu (VIN) are 17 caractere, fără I, O și Q.')).toBeVisible();
    await expect(save).toBeDisabled();
    await page.getByLabel(/Serie de șasiu/).fill('wvwzzzauzgw123456');
    await page.getByLabel(/ITP/).fill(inDays(10));
    await expectNoHorizontalScroll(page);
    await shot(page, 't07-car-form', name());
    await save.click();

    await expect(page).toHaveURL(/\/c\/garaj$/);
    await expect(page.getByText('1 mașină salvată')).toBeVisible();
    await expect(page.getByText('Volkswagen Golf 7')).toBeVisible();
    await expect(page.getByText('BV 12 ABC')).toBeVisible();
    await expect(page.getByText('ITP: în 10 zile')).toBeVisible();
    await expect(page.getByText('RCA: nesetat')).toBeVisible();
    await shot(page, 't07-garage', name());

    // Caută: the banner names the document and the car, and opens the garage.
    await navLink(page, 'Caută').click();
    const banner = page.getByRole('link', { name: /ITP la Golf 7 în 10 zile/ });
    await expect(banner).toBeVisible();
    await shot(page, 't07-search-expiry', name());
    await banner.click();
    await expect(page).toHaveURL(/\/c\/garaj$/);

    // An expired RCA: red, first in the banner, "+1 de verificat".
    await page.getByRole('link', { name: 'Editează Volkswagen Golf 7' }).click();
    await expect(page.getByLabel('Marcă')).toHaveValue('Volkswagen');
    await expect(page.getByLabel(/Serie de șasiu/)).toHaveValue('WVWZZZAUZGW123456');
    await page.getByLabel(/RCA/).fill(inDays(-2));
    await page.getByRole('button', { name: 'Salvează' }).click();
    await expect(page.getByText('RCA: expirat de 2 zile')).toBeVisible();
    await navLink(page, 'Caută').click();
    await expect(page.getByRole('link', { name: /RCA la Golf 7 a expirat acum 2 zile/ })).toContainText('+1 de verificat');

    // Delete: an inline confirmation, then the empty garage.
    await navLink(page, 'Garaj').click();
    await page.getByRole('link', { name: 'Editează Volkswagen Golf 7' }).click();
    await page.getByRole('button', { name: 'Șterge mașina' }).click();
    await expect(page.getByText('Ștergi mașina din garaj?')).toBeVisible();
    await shot(page, 't07-car-delete', name());
    await page.getByRole('button', { name: 'Renunță' }).click();
    await expect(page.getByText('Ștergi mașina din garaj?')).toHaveCount(0);
    await page.getByRole('button', { name: 'Șterge mașina' }).click();
    await page.getByRole('button', { name: 'Da, șterge' }).click();
    await expect(page).toHaveURL(/\/c\/garaj$/);
    await expect(page.getByText('Nicio mașină salvată.')).toBeVisible();
    await navLink(page, 'Caută').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();
    await expect(page.getByRole('link', { name: /la Golf 7/ })).toHaveCount(0);
  });
});

test.describe('booking', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('four steps, success, Programări; with capacity 1 the day turns grey for the next client', async ({ page, browser }) => {
    const shopName = `Atelier T07 ${Date.now() % 100000}${Math.floor(Math.random() * 100)}`;
    const { shopId } = await createBookableShop(shopName, ['ulei', 'frane'], { daily_capacity: 1, inspection_fee: 80 });

    await signInClient(page);
    await page.goto(`/c/service/${shopId}`);
    await page.getByRole('link', { name: 'Programează-te' }).click();

    // 1 — service, grouped by category, no prices.
    await expect(page.getByRole('heading', { level: 1, name: 'Ce ai nevoie?' })).toBeVisible();
    await expect(page.getByText('Pasul 1 din 4')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't07-step1', name());
    await page.getByRole('button', { name: 'Schimb ulei + filtru ulei' }).click();

    // 2 — the next open days with places left.
    await expect(page.getByRole('heading', { level: 1, name: 'Alege ziua' })).toBeVisible();
    const days = page.getByRole('button', { name: /: 1 loc$/ });
    await expect(days.first()).toBeVisible();
    expect(await days.count()).toBeLessThanOrEqual(12);
    await expectNoHorizontalScroll(page);
    await shot(page, 't07-step2', name());
    await days.first().click();

    // 3 — times on the shop's grid.
    await expect(page.getByRole('heading', { level: 1, name: 'Alege ora' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't07-step3', name());
    await page.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();
    const { day, time } = choice(page);
    expect(day >= inDays(0)).toBe(true); // never a past day

    // Back one step keeps the choice; Back again returns to the day.
    await page.getByRole('link', { name: 'Înapoi' }).click();
    await expect(page.getByRole('button', { name: time, pressed: true })).toBeVisible();
    await page.getByRole('button', { name: time }).click();

    // 4 — no saved car: the form, "save to garage" ticked; note; summary with the fee.
    await expect(page.getByRole('heading', { level: 1, name: 'Mașina' })).toBeVisible();
    const send = page.getByRole('button', { name: 'Trimite cererea' });
    await expect(send).toBeDisabled();
    await page.getByLabel('Marcă').fill('Dacia');
    await page.getByLabel('Model').fill('Duster');
    await page.getByLabel('Nr. înmatriculare').fill('bv 07 dus');
    await expect(page.getByLabel('Salvează mașina în garaj')).toBeChecked();
    await page.getByLabel('Observație (opțional)').fill('Aș vrea și verificarea lichidelor.');
    await expect(page.getByText('Dacia Duster · BV 07 DUS')).toBeVisible();
    await expect(page.getByText('80 lei')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't07-step4', name());
    await send.click();

    await expect(page.getByRole('heading', { level: 1, name: 'Cerere trimisă' })).toBeVisible();
    await expect(page.getByText(shopName)).toBeVisible();
    await shot(page, 't07-sent', name());
    await page.getByRole('link', { name: 'Vezi programările' }).click();
    await expect(page).toHaveURL(/\/c\/programari$/);
    const card = page.locator('li').filter({ hasText: shopName });
    await expect(card).toContainText('Schimb ulei + filtru ulei');
    await expect(card).toContainText('În așteptare');
    await expect(card).toContainText('Dacia Duster · BV 07 DUS');
    await shot(page, 't07-bookings', name());

    // Live: the shop confirms (T08 adds its screen) and the card changes without a reload.
    const [booking] = await serviceRest<{ id: string }[]>(`bookings?shop_id=eq.${shopId}&select=id`, 'GET');
    await serviceRest(`bookings?id=eq.${booking!.id}`, 'PATCH', { status: 'confirmed', confirmed_at: new Date().toISOString() });
    await expect(card).toContainText('Confirmată');
    await expect(card).not.toContainText('În așteptare');

    // The typed car went to the garage; the next booking offers it in one tap.
    await navLink(page, 'Garaj').click();
    await expect(page.getByText('Dacia Duster')).toBeVisible();

    // A second client (in English): the same day is full and cannot be picked.
    const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    // Signs in on the Romanian form; the account's language (English) takes over after that.
    await other.addInitScript(() => {
      if (!sessionStorage.getItem('sh_test_init')) {
        sessionStorage.setItem('sh_test_init', '1');
        localStorage.setItem('sh_lang', 'ro');
      }
    });
    const page2 = await other.newPage();
    await signInClient(page2, 'en');
    await page2.goto(`/c/service/${shopId}/programare?pas=2&serviciu=ulei`);
    await expect(page2.getByRole('heading', { level: 1, name: 'Pick a day' })).toBeVisible();
    const fullDay = page2.getByRole('button', { name: `${formatDate('en', day)}: full` });
    await expect(fullDay).toBeDisabled();
    await shot(page2, 't07-step2-full-en', name());

    // The screen stays open on step 4 while someone else takes the last place of that day.
    await page2.getByRole('button', { name: /: 1 spot$/ }).first().click();
    await page2.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();
    const picked = choice(page2);
    await page2.getByLabel('Make').fill('Skoda');
    await page2.getByLabel('Model').fill('Octavia');
    await serviceRest('bookings', 'POST', {
      shop_id: shopId,
      service_id: 'ulei',
      date: picked.day,
      slot: picked.time,
      status: 'pending',
      client_name: 'Walk-in',
    });
    await page2.getByRole('button', { name: 'Send request' }).click();
    await expect(page2.getByRole('heading', { level: 1, name: 'Pick a day' })).toBeVisible();
    await expect(page2.getByText('That day just filled up. Pick another day.')).toBeVisible();
    await expect(page2.getByRole('button', { name: `${formatDate('en', picked.day)}: full` })).toBeDisabled();
    await expectNoHorizontalScroll(page2);
    await shot(page2, 't07-day-filled-en', name());
    await other.close();
  });

  test('a client whose email is not confirmed sees why instead of the send button', async ({ page }) => {
    const { shopId } = await createBookableShop(`Atelier Email ${Date.now() % 100000}`, ['ulei']);
    const email = await signInClient(page);
    await serviceRest(`profiles?id=eq.${await userIdOf(email)}`, 'PATCH', { email_verified_at: null });
    await page.goto(`/c/service/${shopId}/programare?pas=2&serviciu=ulei`);
    await page.getByRole('button', { name: /: \d+ loc/ }).first().click();
    await page.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mașina' })).toBeVisible();
    await expect(page.getByText(/ca să poți trimite cererea/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trimite cererea' })).toHaveCount(0);
  });
});
