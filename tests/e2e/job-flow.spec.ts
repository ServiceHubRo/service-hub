import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  rpcAs,
  shot,
  signIn,
} from './support';

// T09 — the client decides on the quote (partially), the shop starts and completes the job with a
// mandatory odometer reading, the client reviews it; refusing names the inspection fee; cancelling
// only until the shop's deadline. Two browsers at once: every change shows up live on the other.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

const name = () => test.info().project.name;
const navLink = (page: Page, label: string | RegExp) =>
  page.getByRole('link', { name: label, exact: typeof label === 'string' }).filter({ visible: true }).first();
const clientCard = (page: Page, ref: string) => page.locator('main section li').filter({ hasText: ref });
const shopCard = (page: Page, ref: string) => page.locator('main ul[aria-label] > li').filter({ hasText: ref });

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

const rid = () => crypto.randomUUID();

async function book(client: string, shopId: string, at: { date: string; slot: string }, plate: string) {
  return rpcAs<{ id: string; ref: string }>(client, 'create_booking', {
    p_shop_id: shopId,
    p_service_id: 'frane',
    p_date: at.date,
    p_slot: at.slot,
    p_request_id: rid(),
    p_car: { make: 'Dacia', model: 'Logan', year: 2019, plate },
    p_save_car: false,
  });
}

const QUOTE = [
  { name: 'Plăcuțe frână față', price: 280 },
  { name: 'Discuri frână față', price: 420 },
  { name: 'Manoperă', price: 150 },
];

/** pending → confirmed → in_inspection → quote_sent, as the shop. */
async function toQuote(shop: string, bookingId: string) {
  await rpcAs(shop, 'confirm_booking', { p_booking_id: bookingId, p_request_id: rid() });
  await rpcAs(shop, 'start_inspection', { p_booking_id: bookingId, p_request_id: rid() });
  await rpcAs(shop, 'send_quote', { p_booking_id: bookingId, p_items: QUOTE, p_request_id: rid() });
}

function plate(): string {
  const letters = Array.from({ length: 3 }, () => 'ABCDEFGHJKLMNPRSTUVWXZ'[Math.floor(Math.random() * 22)]).join('');
  return `BV ${10 + Math.floor(Math.random() * 89)} ${letters}`;
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

test.describe('quote, work, completion, review', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test('partial approval, refusal with the fee, work, odometer, review, cancel — live on both sides', async ({ page, browser }) => {
    const { email: shop, shopId } = await createBookableShop(`Atelier T09 ${Date.now()}`, ['frane'], { inspection_fee: 100 });
    const client = await createUser('client');
    const [a, b, c] = await freeSlots(client, shopId, 3);
    const carPlate = plate();
    const accepted = await book(client, shopId, a!, carPlate);
    const refused = await book(client, shopId, b!, carPlate);
    const pendingBooking = await book(client, shopId, c!, carPlate);
    await toQuote(shop, accepted.id);
    await toQuote(shop, refused.id);

    // The shop watches its scheduled bookings in a second browser.
    const shopPage = await signedIn(browser, page, shop);
    await shopPage.goto('/s/programari?tab=programate');
    await expect(shopCard(shopPage, accepted.ref)).toContainText('Deviz trimis — se așteaptă răspunsul clientului.');

    // Client: the tab badge counts the two quotes waiting.
    await signIn(page, client, PASSWORD);
    await expect(navLink(page, /^Programări/)).toHaveAccessibleName(/2 devize de aprobat/);
    await navLink(page, /^Programări/).click();
    // Every line ticked: "Accept", total 850. Unticking the discs → 430 and "Accept selectate".
    const first = clientCard(page, accepted.ref);
    await expect(first.getByRole('checkbox')).toHaveCount(3);
    await expect(first).toContainText('850 lei');
    await expect(first.getByRole('button', { name: 'Accept', exact: true })).toBeVisible();
    await expect(first).toContainText('Taxa de constatare de 100 lei se plătește doar dacă refuzi tot devizul.');
    await expectNoHorizontalScroll(page);
    await shot(page, 't09-client-quote', name());
    await first.getByRole('checkbox', { name: /Discuri frână față/ }).uncheck();
    await expect(first).toContainText('Total selectat');
    await expect(first).toContainText('430 lei');
    // Unticking everything leaves only the refusal.
    await first.getByRole('checkbox', { name: /Plăcuțe/ }).uncheck();
    await first.getByRole('checkbox', { name: /Manoperă/ }).uncheck();
    await expect(first.getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
    await expect(first).toContainText('Nu ai bifat nicio poziție');
    await first.getByRole('checkbox', { name: /Plăcuțe/ }).check();
    await first.getByRole('checkbox', { name: /Manoperă/ }).check();
    await first.getByRole('button', { name: 'Accept selectate' }).click();
    await expect(first).toContainText('Ai acceptat 2 din 3 poziții — 430 lei. Lucrarea urmează.');
    await expect(first).toContainText('Deviz acceptat');

    // The shop sees it without a reload: exactly the approved lines, and "În lucru".
    const shopA = shopCard(shopPage, accepted.ref);
    await expect(shopA).toContainText('Clientul a acceptat 2 din 3 poziții: 430 lei.');
    await expect(shopA.getByRole('button', { name: 'În lucru' })).toBeVisible();

    // Refusing asks first and names the fee.
    const refuseCard = clientCard(page, refused.ref);
    await refuseCard.getByRole('button', { name: 'Refuz', exact: true }).click();
    await expect(refuseCard.getByRole('heading', { name: 'Refuzi devizul?' })).toBeFocused();
    await expect(refuseCard).toContainText('Se percepe taxa de constatare de 100 lei.');
    await shot(page, 't09-client-refuse', name());
    await refuseCard.getByRole('button', { name: 'Refuz devizul' }).click();
    await expect(refuseCard).toContainText('Deviz refuzat. Taxă de constatare: 100 lei.');
    await expect(navLink(page, /^Programări/)).not.toHaveAccessibleName(/de aprobat/);
    await expect(shopCard(shopPage, refused.ref)).toHaveCount(0);

    // Shop: În lucru → the client sees it live.
    await shopA.getByRole('button', { name: 'În lucru' }).click();
    await expect(shopPage.getByText(`Lucrarea la ${accepted.ref} a început. Clientul a aflat.`)).toBeVisible();
    await expect(clientCard(page, accepted.ref)).toContainText('Mașina ta este în lucru');

    // Finalizare: prefilled from the approved lines only; no completion without the odometer.
    await shopA.getByRole('button', { name: 'Finalizare' }).click();
    await expect(shopA.getByLabel('Ce s-a lucrat (opțional)')).toHaveValue('Plăcuțe frână față, Manoperă');
    await expect(shopA.getByLabel('Cost total, lei (opțional)')).toHaveValue('430');
    await expect(shopA.getByText('Prima lucrare înregistrată pentru acest număr.')).toBeVisible();
    const odometer = shopA.getByLabel('Kilometraj');
    await expect(odometer).toBeFocused();
    await expect(odometer).toHaveAttribute('inputmode', 'numeric');
    await expect(shopA.getByRole('button', { name: 'Confirmă finalizarea' })).toBeDisabled();
    await odometer.fill('105.400');
    await expectNoHorizontalScroll(shopPage);
    await shot(shopPage, 't09-shop-complete', name());
    await shopA.getByRole('button', { name: 'Confirmă finalizarea' }).click();
    await expect(shopPage.getByText(`Lucrarea ${accepted.ref} este finalizată.`, { exact: false })).toBeVisible();
    await expect(shopA).toHaveCount(0);

    // Client: ready for pickup, with the odometer, the work and the amount; then the review.
    const done = clientCard(page, accepted.ref);
    await expect(done).toContainText('Gata de ridicare');
    await expect(done).toContainText('105.400 km');
    await expect(done).toContainText('Plăcuțe frână față, Manoperă');
    await expect(done).toContainText('430 lei');
    await expect(done.getByRole('link', { name: 'Programează din nou' })).toHaveAttribute('href', new RegExp(`/c/service/${shopId}/programare\\?pas=2&serviciu=frane`));
    await done.getByRole('button', { name: 'Lasă o recenzie' }).click();
    await done.getByRole('button', { name: 'Trimite recenzia' }).click();
    await expect(done.getByText('Alege o notă.')).toBeVisible();
    await done.getByRole('button', { name: '5 din 5 stele' }).click();
    await expect(done.getByRole('button', { name: '5 din 5 stele' })).toHaveAttribute('aria-pressed', 'true');
    await done.getByLabel('Cum a fost? (opțional)').fill('Rapid și corect.');
    await shot(page, 't09-client-review', name());
    await done.getByRole('button', { name: 'Trimite recenzia' }).click();
    await expect(done.getByText('Recenzie trimisă')).toBeVisible();
    await expect(done.getByRole('button', { name: 'Lasă o recenzie' })).toHaveCount(0);

    // Cancelling a request: asks first, then it moves to "Încheiate".
    const pending = clientCard(page, pendingBooking.ref);
    await expect(pending).toContainText('Service-ul îți confirmă cererea în curând.');
    await pending.getByRole('button', { name: 'Anulează' }).click();
    await pending.getByRole('button', { name: 'Anulează programarea' }).click();
    await expect(pending).toContainText('Ai anulat programarea.');
    await expectNoHorizontalScroll(page);
    await shot(page, 't09-client-list', name());

    // English.
    await page.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    await expect(page.getByText('Ready for pickup')).toBeVisible();
    await expect(page.getByText('Quote declined. Inspection fee: 100 RON.')).toBeVisible();
    await shot(page, 't09-client-list-en', name());
    await shopPage.context().close();
  });

  test('odometer: lower than the last reading is refused and named; a big jump needs a tick', async ({ page }) => {
    const { email: shop, shopId } = await createBookableShop(`Atelier Km ${Date.now()}`, ['frane']);
    const client = await createUser('client');
    const [a, b] = await freeSlots(client, shopId, 2);
    const carPlate = plate();
    const first = await book(client, shopId, a!, carPlate);
    const second = await book(client, shopId, b!, carPlate);
    for (const id of [first.id, second.id]) await toQuote(shop, id);
    // Accept every line of both quotes and start the work (as the client and the shop would).
    for (const id of [first.id, second.id]) {
      const quote = await clientQuote(client, id);
      await rpcAs(client, 'decide_quote', { p_booking_id: id, p_quote_id: quote.id, p_approved_item_ids: quote.items, p_request_id: rid() });
      await rpcAs(shop, 'start_work', { p_booking_id: id, p_request_id: rid() });
    }
    await rpcAs(shop, 'complete_job', { p_booking_id: first.id, p_odometer: 105400, p_request_id: rid() });

    await signIn(page, shop, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await page.goto('/s/programari?tab=programate&filtru=lucru');
    const job = shopCard(page, second.ref);
    await job.getByRole('button', { name: 'Finalizare' }).click();
    await expect(job.getByText('Ultima valoare înregistrată: 105.400 km.')).toBeVisible();
    const odometer = job.getByLabel('Kilometraj');
    await odometer.fill('98000');
    await job.getByLabel('Ce s-a lucrat (opțional)').click();
    await expect(job.getByText('Ultima valoare înregistrată a fost 105.400 km. Verifică cifra.')).toBeVisible();
    await expect(job.getByRole('button', { name: 'Confirmă finalizarea' })).toBeDisabled();
    await shot(page, 't09-shop-odometer-lower', name());

    // More than 50 000 km above: an explicit confirmation before the button works.
    await odometer.fill('160000');
    await expect(job.getByText('Sunt 54.600 km în plus față de ultima lucrare. Confirmi?')).toBeVisible();
    await expect(job.getByRole('button', { name: 'Confirmă finalizarea' })).toBeDisabled();
    await job.getByText('Da, kilometrajul este corect').click();
    await job.getByRole('button', { name: 'Confirmă finalizarea' }).click();
    await expect(page.getByText(`Lucrarea ${second.ref} este finalizată.`, { exact: false })).toBeVisible();
  });

  test('after the shop’s deadline the client is told to contact the shop', async ({ page }) => {
    const { email: shop, shopId } = await createBookableShop(`Atelier Termen ${Date.now()}`, ['frane'], { cancel_deadline_hours: 168 });
    const client = await createUser('client');
    const [a] = await freeSlots(client, shopId, 1);
    const booking = await book(client, shopId, a!, plate());
    await rpcAs(shop, 'confirm_booking', { p_booking_id: booking.id, p_request_id: rid() });

    await signIn(page, client, PASSWORD);
    await navLink(page, /^Programări/).click();
    const confirmed = clientCard(page, booking.ref);
    await expect(confirmed).toContainText('Confirmată');
    await expect(confirmed).toContainText('Contactează service-ul pentru a anula.');
    await expect(confirmed.getByRole('button', { name: 'Anulează' })).toHaveCount(0);
  });
});

/** The waiting quote of a booking and its line ids, read as the client (RLS applies). */
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

