import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  BACKEND,
  PASSWORD,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  openAccount,
  rpcAs,
  shot,
  signIn,
} from './support';

// T10 — the shop's repair history (search, filters, the opened card, CSV) and the client's vehicle
// history, reached from the garage card, from Cont and from a finished booking.

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
const navLink = (page: Page, label: string | RegExp) =>
  page.getByRole('link', { name: label, exact: typeof label === 'string' }).filter({ visible: true }).first();
const jobCards = (page: Page) => page.locator('main ul > li').filter({ has: page.locator('button[aria-expanded]') });

interface Day {
  date: string;
  bookable: boolean;
}
interface Slot {
  time: string;
  available: boolean;
}

/** Free (date, time) pairs of a shop, as a client sees them. */
async function freeSlots(email: string, shopId: string, count: number): Promise<{ date: string; slot: string }[]> {
  const av = await rpcAs<{ days: Day[] }>(email, 'get_availability', { p_shop_id: shopId, p_days: 30 });
  const out: { date: string; slot: string }[] = [];
  for (const day of av.days.filter((d) => d.bookable)) {
    const s = await rpcAs<{ slots: Slot[] }>(email, 'get_availability', {
      p_shop_id: shopId,
      p_from: day.date,
      p_days: 1,
      p_slots_for: day.date,
    });
    for (const slot of s.slots.filter((x) => x.available)) {
      out.push({ date: day.date, slot: slot.time });
      if (out.length === count) return out;
    }
  }
  throw new Error('not enough free slots');
}

async function book(client: string, shopId: string, at: { date: string; slot: string }, plate: string, saveCar: boolean) {
  return rpcAs<{ id: string; ref: string }>(client, 'create_booking', {
    p_shop_id: shopId,
    p_service_id: 'frane',
    p_date: at.date,
    p_slot: at.slot,
    p_request_id: rid(),
    p_car: { make: 'Dacia', model: 'Logan', year: 2019, plate },
    p_save_car: saveCar,
  });
}

const QUOTE = [
  { name: 'Plăcuțe frână față', price: 280 },
  { name: 'Manoperă', price: 150 },
];

/** The quote waiting for the client, with its line ids. */
async function clientQuote(client: string, bookingId: string): Promise<{ id: string; items: string[] }> {
  const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
  const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? '';
  const auth = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: client, password: PASSWORD }),
  });
  const token = ((await auth.json()) as { access_token: string }).access_token;
  const res = await fetch(`${API}/rest/v1/quotes?booking_id=eq.${bookingId}&status=eq.sent&select=id,quote_items(id)`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  const [q] = (await res.json()) as { id: string; quote_items: { id: string }[] }[];
  return { id: q!.id, items: q!.quote_items.map((i) => i.id) };
}

/** Confirm, inspect and send the quote; then the client accepts every line or refuses it all. */
async function decide(shop: string, client: string, bookingId: string, accept: boolean) {
  await rpcAs(shop, 'confirm_booking', { p_booking_id: bookingId, p_request_id: rid() });
  await rpcAs(shop, 'start_inspection', { p_booking_id: bookingId, p_request_id: rid() });
  await rpcAs(shop, 'send_quote', { p_booking_id: bookingId, p_items: QUOTE, p_request_id: rid() });
  const quote = await clientQuote(client, bookingId);
  await rpcAs(client, 'decide_quote', {
    p_booking_id: bookingId,
    p_quote_id: quote.id,
    p_approved_item_ids: accept ? quote.items : [],
    p_request_id: rid(),
  });
}

async function finish(shop: string, bookingId: string, odometer: number) {
  await rpcAs(shop, 'start_work', { p_booking_id: bookingId, p_request_id: rid() });
  await rpcAs(shop, 'complete_job', {
    p_booking_id: bookingId,
    p_odometer: odometer,
    p_work: 'Plăcuțe față schimbate',
    p_request_id: rid(),
  });
}

/** A second person in their own browser, signed in, in Romanian. */
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

function letters(): string {
  return Array.from({ length: 3 }, () => 'ABCDEFGHJKLMNPRSTUVWXZ'[Math.floor(Math.random() * 22)]).join('');
}

test.describe('repair history', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test('shop: totals, search by plate, status chip, opened card, CSV; client: the same car from three places', async ({ page, browser }) => {
    const { email: shop, shopId } = await createBookableShop(`Atelier T10 ${Date.now()}`, ['frane'], { inspection_fee: 100 });
    const client = await createUser('client');
    const [a, b, c] = await freeSlots(client, shopId, 3);
    const n = 10 + Math.floor(Math.random() * 89);
    const plate = `BV ${n} ${letters()}`;
    const otherPlate = `CJ ${n} ${letters()}`;
    const done = await book(client, shopId, a!, plate, true); // saves the car in the garage
    const refused = await book(client, shopId, b!, plate, false);
    const other = await book(client, shopId, c!, otherPlate, false);
    await decide(shop, client, done.id, true);
    await finish(shop, done.id, 105400);
    await decide(shop, client, refused.id, false);
    await decide(shop, client, other.id, true);
    await finish(shop, other.id, 50000);

    // ------------------------------------------------------------------ shop
    await signIn(page, shop, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await navLink(page, 'Istoric').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Istoric reparații' })).toBeVisible();
    await expect(page.getByText('2 reparații · 860 lei încasat')).toBeVisible();
    await expect(jobCards(page)).toHaveCount(3);

    // "BV 12" finds every job on that plate (with or without spaces), and nothing else.
    await page.getByLabel('Caută în istoric').fill(`BV ${n}`);
    await expect(jobCards(page)).toHaveCount(2);
    await expect(page.getByText('1 reparație · 430 lei încasat')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`q=BV\\+${n}`));
    await page.getByLabel('Caută în istoric').fill(plate.replace(/\s/g, '').toLowerCase());
    await expect(jobCards(page)).toHaveCount(2);

    // The finished job opens with the quote, the odometer and the conversation.
    const card = jobCards(page).filter({ hasText: '430 lei' });
    await expect(card).toContainText('105.400 km');
    await card.getByRole('button', { expanded: false }).click();
    await expect(card).toContainText('Plăcuțe frână față');
    await expect(card).toContainText('Total aprobat');
    await expect(card).toContainText(`Programarea ${done.ref}`);
    await expect(card.getByRole('link', { name: 'Mesaj' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't10-shop-history', name());

    // Status chip: the refused quote alone, with its inspection fee.
    await page.getByRole('button', { name: 'Deviz refuzat', exact: true }).click();
    await expect(jobCards(page)).toHaveCount(1);
    await expect(jobCards(page).first()).toContainText('Deviz refuzat');
    await jobCards(page).first().getByRole('button', { expanded: false }).click();
    await expect(jobCards(page).first()).toContainText('Taxă de constatare: 100 lei');

    // The CSV holds the filtered list, with the odometer.
    await page.getByRole('button', { name: 'Toate', exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descarcă istoricul' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^istoric-reparatii-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv).toContain('Data;Cod programare;Status;Număr');
    expect(csv).toContain(`${done.ref};Finalizată;${plate};Dacia Logan 2019`);
    expect(csv).toContain(';105400;');
    expect(csv).not.toContain(otherPlate);

    // A search with no match offers to clear the filters.
    await page.getByLabel('Caută în istoric').fill('zzzz');
    await expect(page.getByText('Niciun rezultat pentru „zzzz”.')).toBeVisible();
    await page.getByRole('button', { name: 'Șterge filtrele' }).click();
    await expect(jobCards(page)).toHaveCount(3);

    // ------------------------------------------------------------------ client
    const me = await signedIn(browser, page, client);

    // 1. The garage card.
    await navLink(me, 'Garaj').click();
    await me.getByRole('link', { name: 'Istoric — 1 lucrare' }).click();
    await expect(me).toHaveURL(/\/c\/garaj\/[^/]+\/istoric$/);
    const carUrl = me.url();
    await expect(me.getByRole('heading', { level: 1, name: 'Dacia Logan' })).toBeVisible();
    await expect(me.getByText('1 lucrare · 430 lei cheltuit în total')).toBeVisible();
    await expect(jobCards(me)).toHaveCount(1);
    await expect(jobCards(me).first()).toContainText('105.400 km');
    await jobCards(me).first().getByRole('button', { expanded: false }).click();
    await expect(jobCards(me).first()).toContainText('Plăcuțe frână față');
    await expect(jobCards(me).first().getByRole('link', { name: 'Programează din nou' })).toHaveAttribute(
      'href',
      `/c/service/${shopId}/programare?pas=2&serviciu=frane`,
    );
    await expectNoHorizontalScroll(me);
    await shot(me, 't10-client-vehicle', name());
    await me.getByRole('link', { name: 'Garaj' }).filter({ visible: true }).first().click();
    await expect(me).toHaveURL(/\/c\/garaj$/);

    // 2. Cont → "Istoricul mașinilor mele": the garage car, and the other car (not in the garage).
    await openAccount(me);
    await me.getByRole('link', { name: /Istoricul mașinilor mele/ }).click();
    await expect(me.getByRole('heading', { level: 1, name: 'Istoricul mașinilor mele' })).toBeVisible();
    await expect(me.getByText('Alte mașini')).toBeVisible();
    await me.getByRole('link', { name: new RegExp(plate) }).click();
    await expect(me).toHaveURL(carUrl);
    await expect(me.getByRole('link', { name: 'Istoricul mașinilor mele' })).toBeVisible(); // back link

    // 3. The finished booking in Programări.
    await navLink(me, /^Programări/).click();
    await me
      .locator('main section li')
      .filter({ hasText: done.ref })
      .getByRole('link', { name: 'Vezi istoricul mașinii' })
      .click();
    await expect(me).toHaveURL(new RegExp(`/c/programari/${done.id}/istoric$`));
    await expect(me.getByRole('heading', { level: 1, name: 'Dacia Logan' })).toBeVisible();
    await expect(me.getByText('1 lucrare · 430 lei cheltuit în total')).toBeVisible();
    await me.context().close();
  });
});
