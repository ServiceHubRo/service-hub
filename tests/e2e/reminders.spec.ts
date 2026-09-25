import { expect, test, type Page } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
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

// T19d — client reminders in the app: a finished job still waiting for a review shows a card on
// Caută that opens the booking with the review form; Cont turns service reminders off and on.
// (The pushes themselves, sent by the hourly job, are covered by tests/sql/88_client_reminders.sql.)

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

const name = () => test.info().project.name;
const rid = () => crypto.randomUUID();

interface Day {
  date: string;
  bookable: boolean;
}
interface Slot {
  time: string;
  available: boolean;
}

function plate(): string {
  const letters = Array.from({ length: 3 }, () => 'ABCDEFGHJKLMNPRSTUVWXZ'[Math.floor(Math.random() * 22)]).join('');
  return `BV ${10 + Math.floor(Math.random() * 89)} ${letters}`;
}

/** A booking of `client` at `shopId`, taken through the quote to a finished job. */
async function finishedJob(client: string, shop: string, shopId: string): Promise<{ id: string; ref: string }> {
  const av = await rpcAs<{ days: Day[] }>(client, 'get_availability', { p_shop_id: shopId, p_days: 30 });
  const day = av.days.find((d) => d.bookable)!;
  const s = await rpcAs<{ slots: Slot[] }>(client, 'get_availability', { p_shop_id: shopId, p_from: day.date, p_days: 1, p_slots_for: day.date });
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

/** The language lives on the profile: switched in Cont, then back to the tab `to`. */
async function setLanguage(page: Page, lang: 'ro' | 'en', to?: string) {
  await page.getByRole('link', { name: lang === 'en' ? 'Cont' : 'Account', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: lang === 'en' ? 'English' : 'Română' }).filter({ visible: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: lang === 'en' ? 'Account' : 'Cont' })).toBeVisible();
  if (to) await page.getByRole('link', { name: to, exact: true }).filter({ visible: true }).first().click();
}

test.describe('client reminders', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(90_000);

  test('the review card on Caută opens the booking with the form; gone once reviewed', async ({ page }) => {
    const shopName = `Atelier T19d ${Date.now()}`;
    const { email: shop, shopId } = await createBookableShop(shopName, ['ulei']);
    const client = await createUser('client');
    const booking = await finishedJob(client, shop, shopId);

    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    const card = page.getByRole('region', { name: 'Recenzie de lăsat' });
    await expect(card).toContainText(`Cum a fost la ${shopName}? Lasă o recenzie.`);
    await expect(card).toContainText('Schimb ulei');
    await expectNoHorizontalScroll(page);
    await shot(page, 't19d-review-card', name());

    await setLanguage(page, 'en', 'Search');
    const cardEn = page.getByRole('region', { name: 'A review to leave' });
    await expect(cardEn).toContainText(`How was it at ${shopName}? Leave a review.`);
    await expectNoHorizontalScroll(page);
    await shot(page, 't19d-review-card-en', name());
    await setLanguage(page, 'ro', 'Caută');

    // "Nu acum" hides it for this visit only.
    await card.getByRole('button', { name: 'Nu acum' }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(card).toHaveCount(0);
    await page.evaluate(() => sessionStorage.removeItem('sh_review_prompt_hidden'));
    await page.reload();

    // The same address the push opens: the booking, with the review form already open.
    await card.getByRole('link', { name: 'Lasă recenzia' }).click();
    await expect(page).toHaveURL(new RegExp(`/c/programari\\?p=${booking.id}&recenzie=1`));
    const done = page.locator('main section li').filter({ hasText: booking.ref });
    await expect(done.getByRole('button', { name: 'Trimite recenzia' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't19d-review-open', name());
    await done.getByRole('button', { name: '5 din 5 stele' }).click();
    await done.getByRole('button', { name: 'Trimite recenzia' }).click();
    await expect(done.getByText('Recenzie trimisă')).toBeVisible();

    await page.getByRole('link', { name: 'Caută', exact: true }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/c\/cauta/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(card).toHaveCount(0);
  });

  test('Cont: service reminders off and on, saved on the account', async ({ page }) => {
    const client = await createUser('client');
    await signIn(page, client, PASSWORD);
    await openAccount(page);
    const row = page.getByRole('group', { name: 'Remindere de revizie' });
    await expect(row).toContainText('Pornite.');
    await expectNoHorizontalScroll(page);
    await shot(page, 't19d-account-reminders', name());

    await row.getByRole('button', { name: 'Oprește' }).click();
    await expect(row).toContainText('Oprite.');
    const [profile] = await serviceRest<{ service_reminders: boolean }[]>(
      `profiles?id=eq.${await userIdOf(client)}&select=service_reminders`,
      'GET',
    );
    expect(profile!.service_reminders).toBe(false);

    await page.reload();
    await expect(row).toContainText('Oprite.');
    await setLanguage(page, 'en');
    await expect(page.getByRole('button', { name: 'English' }).filter({ visible: true }).first()).toBeVisible();
    const rowEn = page.getByRole('group', { name: 'Service reminders' });
    await expect(rowEn).toContainText('Off.');
    await shot(page, 't19d-account-reminders-en', name());
    await rowEn.getByRole('button', { name: 'Turn on' }).click();
    await expect(rowEn).toContainText('On.');
  });
});
