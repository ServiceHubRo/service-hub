import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  createBookableShop,
  createUser,
  expectAccessible,
  expectNoHorizontalScroll,
  isDesktop,
  openAccount,
  rpcAs,
  serviceRest,
  shot,
  signIn,
} from './support';

// T11 — messages between a client and a shop, live on both sides, with automatic messages in the
// reader's language; the "Mesaj" button on booking cards; the shop's reviews: reply, edit, report,
// a new review arriving live.

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
const navLink = (page: Page, label: RegExp) => page.getByRole('link', { name: label }).filter({ visible: true }).first();

interface Day {
  date: string;
  bookable: boolean;
}
interface Slot {
  time: string;
  available: boolean;
}

async function freeSlots(email: string, shopId: string, count: number): Promise<{ date: string; slot: string }[]> {
  const av = await rpcAs<{ days: Day[] }>(email, 'get_availability', { p_shop_id: shopId, p_days: 30 });
  const out: { date: string; slot: string }[] = [];
  for (const day of av.days.filter((d) => d.bookable)) {
    const s = await rpcAs<{ slots: Slot[] }>(email, 'get_availability', { p_shop_id: shopId, p_from: day.date, p_days: 1, p_slots_for: day.date });
    for (const slot of s.slots.filter((x) => x.available)) {
      out.push({ date: day.date, slot: slot.time });
      if (out.length === count) return out;
    }
  }
  throw new Error('not enough free slots');
}

async function book(client: string, shopId: string, at: { date: string; slot: string }) {
  return rpcAs<{ id: string; ref: string }>(client, 'create_booking', {
    p_shop_id: shopId,
    p_service_id: 'frane',
    p_date: at.date,
    p_slot: at.slot,
    p_request_id: rid(),
    p_car: { make: 'Dacia', model: 'Logan', year: 2019, plate: 'BV 11 MSG' },
    p_save_car: false,
  });
}

/** The whole job flow through the database functions, up to a review. */
async function doneAndReviewed(shop: string, client: string, bookingId: string, rating: number, text: string) {
  await rpcAs(shop, 'confirm_booking', { p_booking_id: bookingId, p_request_id: rid() });
  await rpcAs(shop, 'start_inspection', { p_booking_id: bookingId, p_request_id: rid() });
  await rpcAs(shop, 'send_quote', { p_booking_id: bookingId, p_items: [{ name: 'Plăcuțe', price: 300 }], p_request_id: rid() });
  const [quote] = await serviceRest<{ id: string; items: { id: string }[] }[]>(
    `quotes?booking_id=eq.${bookingId}&status=eq.sent&select=id,items:quote_items(id)`,
    'GET',
  );
  await rpcAs(client, 'decide_quote', {
    p_booking_id: bookingId,
    p_quote_id: quote!.id,
    p_approved_item_ids: quote!.items.map((i) => i.id),
    p_request_id: rid(),
  });
  await rpcAs(shop, 'start_work', { p_booking_id: bookingId, p_request_id: rid() });
  await rpcAs(shop, 'complete_job', { p_booking_id: bookingId, p_odometer: 120000, p_request_id: rid() });
  await rpcAs(client, 'submit_review', { p_booking_id: bookingId, p_rating: rating, p_text: text, p_request_id: rid() });
}

async function signedIn(browser: Browser, page: Page, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, timezoneId: 'Europe/Berlin' });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
  const other = await context.newPage();
  await signIn(other, email, PASSWORD);
  await expect(other).toHaveURL(/\/(c|s)\//);
  return other;
}

test.describe('messages and reviews', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test('a conversation live on both sides, with automatic messages and the Mesaj button', async ({ page, browser }) => {
    const { email: shop, shopId } = await createBookableShop(`Atelier T11 ${Date.now()}`, ['frane']);
    const client = await createUser('client');
    const [slot] = await freeSlots(client, shopId, 1);
    const booking = await book(client, shopId, slot!);

    // Shop: the new request is an unread conversation, on the tab and in the list.
    const shopPage = await signedIn(browser, page, shop);
    await expect(navLink(shopPage, /^Mesaje/)).toHaveAccessibleName(/o conversație necitită/);
    await navLink(shopPage, /^Mesaje/).click();
    const shopThread = shopPage.locator('main li').filter({ hasText: 'Maria Pop' });
    await expect(shopThread).toContainText(`Cerere nouă de programare: ${booking.ref}.`);
    await expect(shopThread).toContainText('1 necitite');

    // Client: Programări → Mesaj opens the conversation with the shop.
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\//);
    await navLink(page, /^Programări/).click();
    const card = page.locator('main section li').filter({ hasText: booking.ref });
    await card.getByRole('link', { name: 'Mesaj' }).click();
    await expect(page).toHaveURL(/\/c\/mesaje\/[0-9a-f-]{36}$/);
    const log = page.getByRole('log');
    await expect(log).toContainText(`Ai trimis cererea ${booking.ref}. Service-ul o confirmă în curând.`);
    await expect(log).toContainText('mesaj automat');
    // Back returns to Programări (the booking's address was replaced by the conversation).
    await page.goBack();
    await expect(page).toHaveURL(/\/c\/programari$/);
    await page.goForward();

    // The client writes; the shop's list moves and counts it without a reload.
    const input = page.getByLabel('Mesaj', { exact: true });
    await expect(page.getByRole('button', { name: 'Trimite' })).toBeDisabled();
    await input.fill('Bună ziua, pot veni la 9?');
    await page.getByRole('button', { name: 'Trimite' }).click();
    await expect(log.getByText('Bună ziua, pot veni la 9?')).toBeVisible();
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(shopThread).toContainText('Bună ziua, pot veni la 9?');
    await expect(shopThread).toContainText('2 necitite');
    await expectNoHorizontalScroll(shopPage);
    await shot(shopPage, 't11-shop-list', name());

    // The shop opens it (read: the badge goes) and answers; the client sees it live.
    await shopThread.getByRole('link').click();
    await expect(shopPage.getByRole('log')).toContainText('Bună ziua, pot veni la 9?');
    await expect(navLink(shopPage, /^Mesaje/)).not.toHaveAccessibleName(/necitit/);
    await shopPage.getByLabel('Mesaj', { exact: true }).fill('Da, vă așteptăm.');
    // Enter sends with a keyboard and mouse; on a touch screen it is a new line and the button sends.
    if (isDesktop(shopPage)) await shopPage.getByLabel('Mesaj', { exact: true }).press('Enter');
    else await shopPage.getByRole('button', { name: 'Trimite' }).click();
    await expect(shopPage.getByRole('log').getByText('Da, vă așteptăm.')).toBeVisible();
    await expect(log.getByText('Da, vă așteptăm.')).toBeVisible();

    // A status change writes an automatic message: each side reads its own sentence.
    await rpcAs(shop, 'confirm_booking', { p_booking_id: booking.id, p_request_id: rid() });
    await expect(log).toContainText(`Programarea ${booking.ref} este confirmată:`);
    await expect(shopPage.getByRole('log')).toContainText(`Ai confirmat programarea ${booking.ref}:`);
    await expectNoHorizontalScroll(page);
    await shot(page, 't11-client-conversation', name());
    await shot(shopPage, 't11-shop-conversation', name());
    // T18: a conversation with messages from both sides and an automatic one.
    await expectAccessible(page, 'client conversation');
    await expectAccessible(shopPage, 'shop conversation');

    // Offline: the bar shows; messages sent meanwhile are there once the connection is back.
    await page.context().setOffline(true);
    await expect(page.getByText('Fără conexiune', { exact: false })).toBeVisible();
    await shopPage.getByLabel('Mesaj', { exact: true }).fill('Ne vedem mâine.');
    await shopPage.getByRole('button', { name: 'Trimite' }).click();
    await expect(shopPage.getByRole('log').getByText('Ne vedem mâine.')).toBeVisible();
    await page.context().setOffline(false);
    await expect(page.getByText('Fără conexiune', { exact: false })).toHaveCount(0);
    await expect(log.getByText('Ne vedem mâine.')).toBeVisible({ timeout: 20_000 });

    // English: the same automatic message in the reader's language.
    await page.getByRole('button', { name: /English/ }).filter({ visible: true }).first().click();
    await expect(log).toContainText(`Booking ${booking.ref} is confirmed:`);
    await expect(log).toContainText('automatic message');
    await shot(page, 't11-client-conversation-en', name());

    // The shop's booking card has the button too.
    await shopPage.goto(`/s/programari?tab=programate&p=${booking.id}`);
    await shopPage.locator('main li').filter({ hasText: booking.ref }).getByRole('link', { name: 'Mesaj' }).click();
    await expect(shopPage).toHaveURL(/\/s\/mesaje\/[0-9a-f-]{36}$/);
    await expect(shopPage.getByRole('heading', { level: 1 })).toHaveText('Maria Pop');
  });

  test('no conversations yet: the empty state after loading', async ({ page }) => {
    const client = await createUser('client');
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\//);
    await page.goto('/c/mesaje');
    await expect(page.getByText('Nicio conversație.')).toBeVisible();
    await shot(page, 't11-client-empty', name());
  });

  test('reviews: reply, edit, report, a new review live', async ({ page, browser }) => {
    const { email: shop, shopId } = await createBookableShop(`Atelier Recenzii ${Date.now()}`, ['frane']);
    const client = await createUser('client');
    const [a, b] = await freeSlots(client, shopId, 2);
    const first = await book(client, shopId, a!);
    const second = await book(client, shopId, b!);
    await doneAndReviewed(shop, client, first.id, 4, 'Treabă bună, dar am așteptat.');

    await signIn(page, shop, PASSWORD);
    await expect(page).toHaveURL(/\/s\//);
    await openAccount(page);
    await page.getByRole('link', { name: 'Recenzii' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Recenzii' })).toBeVisible();
    await expect(page.locator('main')).toContainText('4,0');
    await expect(page.locator('main')).toContainText('1 recenzie');
    const review = page.locator('main li').filter({ hasText: 'Treabă bună' });
    await expect(review).toContainText('Maria P.');
    await expect(review).toContainText(first.ref);

    // Reply, then edit it.
    await review.getByRole('button', { name: 'Răspunde' }).click();
    await review.getByLabel('Răspunsul tău').fill('Mulțumim, data viitoare mai repede.');
    await review.getByRole('button', { name: 'Publică' }).click();
    await expect(review).toContainText('Răspunsul service-ului');
    await expect(review).toContainText('Mulțumim, data viitoare mai repede.');
    await review.getByRole('button', { name: 'Editează răspunsul' }).click();
    await expect(review.getByLabel('Răspunsul tău')).toHaveValue('Mulțumim, data viitoare mai repede.');
    await review.getByLabel('Răspunsul tău').fill('Mulțumim!');
    await review.getByRole('button', { name: 'Publică' }).click();
    await expect(review).toContainText('Mulțumim!');

    // A new review appears without a reload.
    await doneAndReviewed(shop, client, second.id, 1, 'Nu recomand.');
    const bad = page.locator('main li').filter({ hasText: 'Nu recomand.' });
    await expect(bad).toBeVisible();
    await expect(page.locator('main')).toContainText('2 recenzii');
    await expect(page.locator('main')).toContainText('2,5');

    // Report: a reason is required; afterwards "Raportată" and the confirmation.
    await bad.getByRole('button', { name: 'Raportează' }).click();
    await expect(bad.getByRole('button', { name: 'Trimite raportarea' })).toBeDisabled();
    await bad.getByText('Limbaj abuziv').click();
    await expectNoHorizontalScroll(page);
    await shot(page, 't11-shop-report', name());
    await bad.getByRole('button', { name: 'Trimite raportarea' }).click();
    await expect(bad).toContainText('Raportată');
    await expect(bad).toContainText('Primești răspuns în maximum 5 zile lucrătoare.');
    await expect(bad.getByRole('button', { name: 'Raportează' })).toHaveCount(0);
    await shot(page, 't11-shop-reviews', name());

    // The client sees the reply on the shop page.
    const clientPage = await signedIn(browser, page, client);
    await clientPage.goto(`/c/service/${shopId}`);
    await expect(clientPage.locator('main')).toContainText('Mulțumim!');
  });
});
