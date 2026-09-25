import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { emailsTo } from './providers';
import {
  BACKEND,
  PASSWORD,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  rpcAs,
  serviceRest,
  shot,
  signIn,
  userIdOf,
} from './support';

// T15 — the paid history report. The client picks a car with finished jobs, sees the preview (the
// last two jobs hidden), pays on the Stripe stand-in (providers.ts), which calls the real
// stripe-webhook with a signed event; the webhook marks the report paid and makes the PDF, and
// Rapoartele mele turns to "Gata" by itself. The PDF downloads; the code checks out on /verifica
// for a visitor without an account, who learns nothing but the car, the count and the dates.

const name = () => test.info().project.name;
const rid = () => crypto.randomUUID();

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

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

/** A finished job on the client's car: booked, confirmed, inspected, quoted, accepted, done. */
async function finishedJob(shop: string, client: string, shopId: string, at: { date: string; slot: string }, plate: string, odometer: number, saveCar: boolean) {
  const booking = await rpcAs<{ id: string }>(client, 'create_booking', {
    p_shop_id: shopId,
    p_service_id: 'ulei',
    p_date: at.date,
    p_slot: at.slot,
    p_request_id: rid(),
    p_car: { make: 'Volkswagen', model: 'Golf 7', year: 2016, plate, vin: 'WVWZZZAUZGW123456' },
    p_save_car: saveCar,
  });
  await rpcAs(shop, 'confirm_booking', { p_booking_id: booking.id, p_request_id: rid() });
  await rpcAs(shop, 'start_inspection', { p_booking_id: booking.id, p_request_id: rid() });
  await rpcAs(shop, 'send_quote', {
    p_booking_id: booking.id,
    p_items: [
      { name: 'Ulei 5W30 5L', price: 255 },
      { name: 'Manoperă', price: 85 },
    ],
    p_request_id: rid(),
  });
  const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
  const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? '';
  const auth = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: client, password: PASSWORD }),
  });
  const token = ((await auth.json()) as { access_token: string }).access_token;
  const res = await fetch(`${API}/rest/v1/quotes?booking_id=eq.${booking.id}&status=eq.sent&select=id,quote_items(id)`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  const [q] = (await res.json()) as { id: string; quote_items: { id: string }[] }[];
  await rpcAs(client, 'decide_quote', {
    p_booking_id: booking.id,
    p_quote_id: q!.id,
    p_approved_item_ids: q!.quote_items.map((i) => i.id),
    p_request_id: rid(),
  });
  await rpcAs(shop, 'start_work', { p_booking_id: booking.id, p_request_id: rid() });
  await rpcAs(shop, 'complete_job', { p_booking_id: booking.id, p_odometer: odometer, p_work: 'Schimb ulei și filtru', p_request_id: rid() });
  return booking.id;
}

async function visitor(browser: Browser, page: Page, lang: 'ro' | 'en'): Promise<Page> {
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, timezoneId: 'Europe/Berlin' });
  await context.addInitScript((l) => localStorage.setItem('sh_lang', l), lang);
  return context.newPage();
}

/** A plate no other test uses (the odometer check looks at every job on a plate). */
function uniquePlate(county: string): string {
  const l = () => 'ABCDEFGHJKLMNPRSTUVWXZ'[Math.floor(Math.random() * 22)];
  return `${county} ${100 + Math.floor(Math.random() * 900)} ${l()}${l()}${l()}`;
}

test.describe('history report', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack and its Stripe stand-in');
  test.setTimeout(150_000);

  // The dispatcher records its address on its first call (the deploy Action does this for real),
  // so the database can wake it for the report_ready email.
  test.beforeAll(async () => {
    await fetch(`${process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'}/functions/v1/dispatch-notifications`);
  });

  test('preview, pay, PDF in Rapoartele mele, verified on /verifica without an account', async ({ page, browser }) => {
    const shopName = `Atelier Raport ${Date.now()}`;
    const { email: shop, shopId } = await createBookableShop(shopName, ['ulei']);
    const client = await createUser('client');
    const plate = uniquePlate('BV');
    const [a, b, c] = await freeSlots(client, shopId, 3);
    await finishedJob(shop, client, shopId, a!, plate, 90000, true);
    await finishedJob(shop, client, shopId, b!, plate, 95000, false);
    await finishedJob(shop, client, shopId, c!, plate, 97500, false);

    // ------------------------------------------------------------------ the garage card → preview
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\//);
    await page.goto('/c/garaj');
    await page.getByRole('link', { name: 'Raport oficial pentru cumpărător' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Raport oficial' })).toBeVisible();
    await expect(page.getByText('Raportul conține doar lucrările efectuate prin Service-Hub.')).toBeVisible();
    await expect(page.getByText('WVWZZZAUZGW123456')).toBeVisible();
    await expect(page.getByText('1.020 lei', { exact: true })).toBeVisible();
    await expect(page.getByText('97.500 km', { exact: true })).toBeVisible();
    // Three jobs, the last two hidden until paid (and hidden from screen readers).
    await expect(page.locator('main li')).toHaveCount(3);
    await expect(page.locator('main li[aria-hidden="true"]')).toHaveCount(2);
    await expect(page.getByText('Vizibil în raport după plată')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't15-report-preview', name());
    await page.getByRole('button', { name: 'Plătește 29 lei' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/shots/t15-report-pay-${name()}.png` });

    // ------------------------------------------------------------------ Stripe's "back": nothing paid
    await page.getByRole('button', { name: 'Plătește 29 lei' }).click();
    await expect(page.getByText('Plată unică: 29 lei')).toBeVisible();
    await page.getByRole('link', { name: 'Înapoi' }).click();
    await expect(page.getByText('Plata nu a fost finalizată. Nu s-a încasat nimic.')).toBeVisible();

    // ------------------------------------------------------------------ pay → the webhook → the PDF
    await page.getByRole('button', { name: 'Plătește 29 lei' }).click();
    await expect(page.getByText('Plată unică: 29 lei')).toBeVisible();
    await page.getByRole('button', { name: 'Plătește' }).click();
    await expect(page).toHaveURL(/\/c\/cont\/rapoarte\?plata=ok&raport=/);
    await expect(page.getByRole('heading', { level: 1, name: 'Rapoartele mele' })).toBeVisible();
    await expect(page.getByText('Mulțumim. Raportul e gata de descărcat.')).toBeVisible({ timeout: 30_000 });
    const card = page.locator('main li').filter({ hasText: plate });
    await expect(card).toContainText('Gata');
    await expect(card).toContainText('3 lucrări');
    const code = (await card.locator('.mono').filter({ hasText: /^SH-\d{4}-\d{6}$/ }).textContent())!.trim();
    await expectNoHorizontalScroll(page);
    await shot(page, 't15-my-reports', name());

    const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Descarcă PDF' }).click()]);
    expect(download.suggestedFilename()).toBe(`raport-${code}.pdf`);
    const bytes = await readFile((await download.path())!);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toContain(code);
    expect(pdf.getTitle()).toContain('Volkswagen Golf 7');

    // The client is told by email, with the code.
    await expect.poll(async () => (await emailsTo(client)).some((m) => m.subject === `Raportul de istoric e gata: ${code}`), { timeout: 20_000 }).toBe(true);

    // Cont has the tile; the vehicle history has the button with the price.
    await page.goto('/c/cont');
    await expect(page.getByRole('link', { name: /Rapoartele mele/ })).toBeVisible();
    await page.goto('/c/garaj');
    await page.getByRole('link', { name: /Istoric — 3 lucrări/ }).click();
    await expect(page.getByRole('link', { name: 'Generează raport oficial — 29 lei' })).toBeVisible();

    // ------------------------------------------------------------------ /verifica, signed out
    const buyer = await visitor(browser, page, 'ro');
    await buyer.goto('/verifica');
    await expect(buyer.getByRole('heading', { level: 1, name: 'Verifică un raport' })).toBeVisible();
    await buyer.getByLabel('Codul raportului').fill(code.toLowerCase().replace(/-/g, ' '));
    await buyer.getByRole('button', { name: 'Verifică' }).click();
    await expect(buyer.getByText('Raport autentic')).toBeVisible();
    await expect(buyer.getByText(plate)).toBeVisible();
    await expect(buyer.getByText('Volkswagen Golf 7')).toBeVisible();
    await expect(buyer).toHaveURL(new RegExp(`cod=${code}`));
    const text = await buyer.locator('main').innerText();
    expect(text).not.toContain(shopName);
    expect(text).not.toMatch(/\d+ lei/);
    expect(text).not.toContain('Maria Pop');
    await expectNoHorizontalScroll(buyer);
    await shot(buyer, 't15-verify', name());

    await buyer.getByLabel('Codul raportului').fill('SH-2020-999999');
    await buyer.getByRole('button', { name: 'Verifică' }).click();
    await expect(buyer.getByText('Nu am găsit niciun raport cu acest cod. Verifică literele și cifrele.')).toBeVisible();
    await buyer.getByLabel('Codul raportului').fill('ABC');
    await buyer.getByRole('button', { name: 'Verifică' }).click();
    await expect(buyer.getByText('Codul are forma SH-2026-000147.')).toBeVisible();

    // In English, from a shared link.
    const buyerEn = await visitor(browser, page, 'en');
    await buyerEn.goto(`/verifica?cod=${code}`);
    await expect(buyerEn.getByText('Genuine report')).toBeVisible();
    await expect(buyerEn.getByText('License plate')).toBeVisible();
    await shot(buyerEn, 't15-verify-en', name());
  });

  test('English preview; a car without finished jobs gets no report', async ({ page }) => {
    const { email: shop, shopId } = await createBookableShop(`Atelier Raport EN ${Date.now()}`, ['ulei']);
    const client = await createUser('client', { lang: 'en' });
    const [a] = await freeSlots(client, shopId, 1);
    await finishedJob(shop, client, shopId, a!, uniquePlate('CJ'), 120000, true);
    // The account's language (English) wins after signing in.
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\//);
    await page.goto('/c/cont/rapoarte');
    await expect(page.getByRole('heading', { level: 1, name: 'My reports' })).toBeVisible();
    await expect(page.getByText('No reports yet.')).toBeVisible();
    await page.getByRole('link', { name: /Volkswagen Golf 7/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Official report' })).toBeVisible();
    await expect(page.getByText('This report covers only work carried out through Service-Hub.')).toBeVisible();
    // One job: shown in full.
    await expect(page.locator('main li[aria-hidden="true"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pay 29 RON' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't15-report-preview-en', name());

    // A saved car with no finished job: no report row in the garage, and its preview says why.
    const owner = await userIdOf(client);
    const [car] = await serviceRest<{ id: string }[]>('cars', 'POST', { owner_id: owner, make: 'Dacia', model: 'Spring', plate: 'B 01 NEW' });
    await page.goto('/c/garaj');
    await expect(page.getByText('Dacia Spring')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Official report for a buyer' })).toHaveCount(1);
    await page.goto(`/c/garaj/${car!.id}/raport`);
    await expect(page.getByText('There are no finished jobs for this car.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Pay/ })).toHaveCount(0);
  });
});
