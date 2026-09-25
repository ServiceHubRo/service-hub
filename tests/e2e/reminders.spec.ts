import { expect, test, type Page } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  SEED,
  SEED_PASSWORD,
  createBookableShop,
  createUser,
  expectAccessible,
  expectNoHorizontalScroll,
  openAccount,
  rpcAs,
  serviceRest,
  shot,
  signIn,
  userIdOf,
} from './support';

// T19d — reminders for clients: the review card on Caută (and the booking a review request opens),
// Cont → Remindere, the service reminder's tap (booking the same service for the same car), and
// the service intervals in the admin catalog. The scheduled jobs themselves are SQL-tested
// (tests/sql/88_client_reminders.sql); their texts and links are unit-tested.

const name = () => test.info().project.name;
const rid = () => crypto.randomUUID();
const tag = () => `${Date.now() % 1_000_000}${Math.floor(Math.random() * 100)}`;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

/** A free (date, time) of a shop, as a client sees it. */
async function freeSlot(client: string, shopId: string): Promise<{ date: string; slot: string }> {
  const av = await rpcAs<{ days: { date: string; bookable: boolean }[] }>(client, 'get_availability', { p_shop_id: shopId, p_days: 30 });
  for (const day of av.days.filter((d) => d.bookable)) {
    const s = await rpcAs<{ slots: { time: string; available: boolean }[] }>(client, 'get_availability', {
      p_shop_id: shopId,
      p_from: day.date,
      p_days: 1,
      p_slots_for: day.date,
    });
    const free = s.slots.find((x) => x.available);
    if (free) return { date: day.date, slot: free.time };
  }
  throw new Error('no free slot');
}

/**
 * A client with a car in the garage and a job finished yesterday at a new shop (the booking made
 * through create_booking, then finished by the service role, as if the shop had done it).
 */
async function clientWithFinishedJob(lang: 'ro' | 'en' = 'ro') {
  const shopName = `Atelier Reminder ${tag()}`;
  const { shopId } = await createBookableShop(shopName, ['ulei']);
  const client = await createUser('client', { lang });
  const at = await freeSlot(client, shopId);
  const booking = await rpcAs<{ id: string; car_id: string }>(client, 'create_booking', {
    p_shop_id: shopId,
    p_service_id: 'ulei',
    p_date: at.date,
    p_slot: at.slot,
    p_request_id: rid(),
    p_car: { make: 'Dacia', model: 'Logan', year: 2019, plate: 'BV 19 REM' },
    p_save_car: true,
  });
  const yesterday = new Date(Date.now() - 86_400_000);
  await serviceRest(`bookings?id=eq.${booking.id}`, 'PATCH', {
    status: 'done',
    done_at: yesterday.toISOString(),
    work: 'Schimb ulei 5W30',
    cost: 340,
    odometer: 105400,
  });
  return { shopName, shopId, client, bookingId: booking.id, carId: booking.car_id };
}

const reviewCard = (page: Page, shopName: string) => page.getByRole('link', { name: new RegExp(`Cum a fost la ${shopName}\\?`) });

test.describe('reminders for clients', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test('the review card on Caută, turned off and on in Cont, opens the review form', async ({ page }) => {
    const { shopName, client, bookingId } = await clientWithFinishedJob();
    await signIn(page, client, PASSWORD);
    await expect(page.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();
    const card = reviewCard(page, shopName);
    await expect(card).toBeVisible();
    await expect(card).toContainText('Lasă o recenzie: Schimb ulei + filtru ulei · Dacia Logan');
    await expectNoHorizontalScroll(page);
    await shot(page, 't19d-search-review-card', name());
    await expectAccessible(page, 'Caută with the review card');

    // Cont → Remindere: both on by default; turning the review request off hides the card.
    await openAccount(page);
    const reminders = page.getByRole('group', { name: 'Remindere' });
    await expect(reminders.getByRole('checkbox', { name: 'Cerere de recenzie după lucrare' })).toBeChecked();
    await expect(reminders.getByRole('checkbox', { name: 'Remindere de revizie' })).toBeChecked();
    await expect(reminders.getByRole('button', { name: 'Salvează reminderele' })).toBeDisabled();
    // Ticking never moves the page (measured once the row is on screen).
    await reminders.getByText('Cerere de recenzie după lucrare').scrollIntoViewIfNeeded();
    const before = await page.locator('main').evaluate((el) => el.scrollTop);
    await reminders.getByText('Cerere de recenzie după lucrare').click();
    expect(await page.locator('main').evaluate((el) => el.scrollTop)).toBe(before);
    await reminders.getByRole('button', { name: 'Salvează reminderele' }).click();
    await expect(reminders.getByRole('button', { name: 'Salvat' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't19d-account-reminders', name());
    const [profile] = await serviceRest<{ review_requests: boolean; service_reminders: boolean }[]>(
      `profiles?id=eq.${await userIdOf(client)}&select=review_requests,service_reminders`,
      'GET',
    );
    expect(profile).toEqual({ review_requests: false, service_reminders: true });

    await page.getByRole('link', { name: 'Caută', exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();
    await expect(reviewCard(page, shopName)).toHaveCount(0);

    await openAccount(page);
    await page.getByRole('group', { name: 'Remindere' }).getByText('Cerere de recenzie după lucrare').click();
    await page.getByRole('group', { name: 'Remindere' }).getByRole('button', { name: 'Salvează reminderele' }).click();
    await expect(page.getByRole('group', { name: 'Remindere' }).getByRole('button', { name: 'Salvat' })).toBeVisible();
    await page.getByRole('link', { name: 'Caută', exact: true }).filter({ visible: true }).first().click();

    // The card (like the push) opens that booking with the review form.
    await reviewCard(page, shopName).click();
    await expect(page).toHaveURL(new RegExp(`/c/programari\\?p=${bookingId}&recenzie=1$`));
    const booking = page.locator(`#booking-${bookingId}`);
    await expect(booking.getByRole('button', { name: 'Trimite recenzia' })).toBeVisible();
    await expect(booking.getByText(`Cum a fost la ${shopName}?`)).toBeVisible();
    await shot(page, 't19d-review-form-open', name());
    await booking.getByRole('button', { name: '5 din 5 stele' }).click();
    await booking.getByRole('button', { name: 'Trimite recenzia' }).click();
    await expect(booking.getByText('Recenzie trimisă')).toBeVisible();

    // Reviewed: the card is gone for good.
    await page.getByRole('link', { name: 'Caută', exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();
    await expect(reviewCard(page, shopName)).toHaveCount(0);
  });

  test('in English', async ({ page }) => {
    const { shopName, client } = await clientWithFinishedJob('en');
    await signIn(page, client, PASSWORD);
    await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
    const card = page.getByRole('link', { name: new RegExp(`How was ${shopName}\\?`) });
    await expect(card).toContainText('Leave a review: Oil & oil filter change · Dacia Logan');
    await shot(page, 't19d-search-review-card-en', name());
    await page.getByRole('link', { name: 'Account', exact: true }).filter({ visible: true }).first().click();
    const reminders = page.getByRole('group', { name: 'Reminders' });
    await expect(reminders.getByRole('checkbox', { name: 'Review request after a job' })).toBeChecked();
    await expect(reminders.getByRole('checkbox', { name: 'Service reminders' })).toBeChecked();
    await expectNoHorizontalScroll(page);
    await shot(page, 't19d-account-reminders-en', name());
  });

  test('the service reminder books the same service for the same car', async ({ page }) => {
    const { shopName, shopId, client } = await clientWithFinishedJob();
    // A second car: the reminder is about this one.
    const [car] = await serviceRest<{ id: string }[]>('cars', 'POST', {
      owner_id: await userIdOf(client),
      make: 'Skoda',
      model: 'Octavia',
      year: 2017,
      plate: 'BV 17 SKO',
    });
    await signIn(page, client, PASSWORD);
    await expect(page.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();

    // The address a tap on "Se apropie termenul pentru schimb ulei…" opens.
    await page.goto(`/c/service/${shopId}/programare?serviciu=ulei&masina=${car!.id}&pas=2`);
    await expect(page.getByRole('heading', { level: 1, name: 'Alege ziua' })).toBeVisible();
    await expect(page.getByText(`Schimb ulei + filtru ulei · ${shopName}`)).toBeVisible();
    await page.getByRole('button', { name: /: \d+ loc/ }).first().click();
    await page.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mașina' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Skoda Octavia/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /Dacia Logan/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'Trimite cererea' })).toBeEnabled();
    await expectNoHorizontalScroll(page);
    await shot(page, 't19d-service-reminder-booking', name());
  });
});

test.describe('service intervals in the catalog', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    // The demo admin is shared by tests running in parallel: its saved language never changes.
    await page.route('**/rest/v1/profiles?*', (route) =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue(),
    );
  });

  test('set, checked, changed, removed', async ({ page }) => {
    const t = tag();
    await signIn(page, SEED.admin, SEED_PASSWORD);
    await expect(page.getByRole('heading', { level: 1, name: 'Prezentare' })).toBeVisible();
    await openAccount(page);
    await page.getByRole('link', { name: /^Catalog de servicii/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Catalog de servicii' })).toBeVisible();

    // A category of its own, so tests running side by side never share a service.
    await page.getByRole('button', { name: 'Categorie nouă' }).click();
    await page.getByLabel('Nume în română').fill(`Remindere ${t}`);
    await page.getByLabel('Nume în engleză').fill(`Reminders ${t}`);
    await page.getByRole('button', { name: 'Adaugă categoria' }).click();
    await page.getByLabel('Caută serviciu sau categorie').fill(`Remindere ${t}`);
    const card = page.getByRole('listitem').filter({ hasText: `cat_remindere_${t}` });
    await card.getByRole('button', { name: new RegExp(`^Serviciu nou în Remindere ${t}`) }).click();
    await card.getByLabel('Nume în română').fill(`Schimb ulei cutie ${t}`);
    await card.getByLabel('Nume în engleză').fill(`Gearbox oil ${t}`);
    const interval = card.getByLabel('Reminder de revizie (luni)');
    await interval.fill('0');
    await expect(card.getByText('Scrie un număr de luni între 1 și 120, sau lasă gol.')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Adaugă serviciul' })).toBeDisabled();
    await interval.fill('18');
    await shot(page, 't19d-catalog-interval', name());
    await card.getByRole('button', { name: 'Adaugă serviciul' }).click();
    await expect(card.getByText('Reminder: la 18 luni')).toBeVisible(); // "18 luni", but "24 de luni" below
    const id = `schimb_ulei_cutie_${t}`;
    const read = async () => (await serviceRest<{ interval_months: number | null }[]>(`services?id=eq.${id}&select=interval_months`, 'GET'))[0]!;
    expect(await read()).toEqual({ interval_months: 18 });

    await card.getByRole('button', { name: `Editează: Schimb ulei cutie ${t}` }).click();
    await expect(card.getByLabel('Reminder de revizie (luni)')).toHaveValue('18');
    await card.getByLabel('Reminder de revizie (luni)').fill('24');
    await card.getByRole('button', { name: 'Salvează' }).click();
    await expect(card.getByText('Reminder: la 24 de luni')).toBeVisible();
    expect(await read()).toEqual({ interval_months: 24 });
    await expectNoHorizontalScroll(page);

    await card.getByRole('button', { name: `Editează: Schimb ulei cutie ${t}` }).click();
    await card.getByLabel('Reminder de revizie (luni)').fill('');
    await card.getByRole('button', { name: 'Salvează' }).click();
    await expect(card.getByText(/^Reminder: la/)).toHaveCount(0);
    expect(await read()).toEqual({ interval_months: null });

    // Switched off, so no other test sees it.
    await card.getByRole('button', { name: `Editează: Remindere ${t}` }).click();
    await card.getByText('Categoria e activă').click();
    await card.getByRole('button', { name: 'Salvează' }).click();
    await expect(card.getByText('Oprit')).toHaveCount(2);

    await openAccount(page);
    await page.getByRole('link', { name: /^Jurnal de audit/ }).click();
    await expect(page.getByText('Reminder de revizie (luni):').first()).toBeVisible();
  });
});
