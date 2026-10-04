import { expect, test } from '@playwright/test';
import { emailsTo } from './providers';
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

// Bookings that look after themselves (Eduard, 3 oct): a request the shop never answers closes at
// its time and the client is pointed, kindly, to other shops nearby; a confirmed booking left open
// gets a question the next morning and closes 7 days later without a no-show; the admin gets a
// morning email when something waits. The jobs run here as pg_cron runs them, at a chosen time.

const name = () => test.info().project.name;
const tag = () => `${Date.now() % 100000}${Math.floor(Math.random() * 100)}`;
const DAY = 86_400_000;
const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

/** A day `days` from today, as YYYY-MM-DD (far enough ahead to be open whatever the time zone). */
function dayFromNow(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
}

/** Today and the time a minute or two from now, in Bucharest (a slot about to begin). */
function slotAboutToBegin(): { date: string; slot: string } {
  const at = new Date(Date.now() + 90_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Bucharest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, slot: `${parts.hour}:${parts.minute}` };
}

/** A booking written straight to the test database, in the future. */
async function booking(
  shopId: string,
  clientId: string,
  status: 'pending' | 'confirmed',
  date: string,
  slot = '10:00',
): Promise<{ id: string; ref: string }> {
  const [row] = await serviceRest<{ id: string; ref: string }[]>('bookings', 'POST', {
    shop_id: shopId,
    client_id: clientId,
    service_id: 'ulei',
    client_name: 'Maria Pop',
    car_snapshot: { make: 'Dacia', model: 'Logan', plate: 'BV 10 TST', plate_norm: 'BV10TST' },
    date,
    slot,
    status,
    ...(status === 'confirmed' ? { confirmed_at: new Date().toISOString() } : {}),
  });
  return row!;
}

/** Runs a scheduled job at a given time, as pg_cron does. */
async function job(fn: string, at: string): Promise<number> {
  return serviceRest<number>(`rpc/${fn}`, 'POST', { p_now: at });
}

test.describe('Bookings that look after themselves', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(240_000);
  // The outbox's sender sets itself up on its first call (as the app does when it asks for push).
  test.beforeAll(async () => {
    if (BACKEND) await fetch(`${API}/functions/v1/dispatch-notifications`);
  });

  test('a request nobody answered: closed at its time, the client is shown other shops', async ({ page }) => {
    const shopName = `Atelier Tacut ${tag()}`;
    const { shopId } = await createBookableShop(shopName, ['ulei']);
    const client = await createUser('client');
    const clientId = await userIdOf(client);
    // A request whose time begins in a minute or two; the job runs at the real time, as pg_cron does
    // every 15 minutes (so it only ever closes requests whose time has really passed).
    const { date, slot } = slotAboutToBegin();
    const request = await booking(shopId, clientId, 'pending', date, slot);
    const state = async () =>
      (await serviceRest<{ status: string; closed_reason: string | null }[]>(`bookings?id=eq.${request.id}&select=status,closed_reason`, 'GET'))[0];
    expect(await job('expire_unanswered_requests', new Date().toISOString())).toBeGreaterThanOrEqual(0);
    expect(await state()).toEqual({ status: 'pending', closed_reason: null });
    await expect
      .poll(
        async () => {
          await job('expire_unanswered_requests', new Date().toISOString());
          return state();
        },
        { timeout: 150_000, intervals: [5_000] },
      )
      .toEqual({ status: 'expired', closed_reason: 'unanswered' });

    // The client's email: kind, with other shops for the same work nearby.
    await expect.poll(async () => (await emailsTo(client)).map((m) => m.subject), { timeout: 20_000 }).toContain(
      'Cererea ta s-a închis: alte service-uri te pot ajuta',
    );
    const mail = (await emailsTo(client)).find((m) => m.subject.startsWith('Cererea ta s-a închis'))!;
    expect(mail.text).toContain(`Ne pare rău, ${shopName} nu a reușit să răspundă la timp`);
    expect(mail.html).toContain('/c/cauta?cat=cat_rev&amp;oras=Bra%C8%99ov');

    // The card says so, and offers the search.
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await page.goto('/c/programari');
    const card = page.locator('main li').filter({ hasText: shopName });
    await expect(card.getByText('Ne pare rău, service-ul nu a răspuns la timp, așa că cererea s-a închis.', { exact: false })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 'request-unanswered', name());
    // In English too.
    await page.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    await expect(card.getByText("We're sorry, the shop didn't answer in time, so the request has closed.", { exact: false })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 'request-unanswered-en', name());
    await page.getByRole('button', { name: 'Română' }).filter({ visible: true }).first().click();
    await card.getByRole('link', { name: 'Caută alt service' }).click();
    await expect(page).toHaveURL(/\/c\/cauta\?cat=cat_rev&oras=Bra%C8%99ov$/);
  });

  // The question the next morning and the closing after 7 days run on past days, which the test
  // database cannot hold for an active booking: tests/sql/106_booking_housekeeping.sql covers them.
  // Here: what the shop sees once the system closed one.
  test('a booking the system closed after 7 days shows in Istoric, never as a no-show', async ({ page }) => {
    const shopName = `Atelier Uituc ${tag()}`;
    const { email: owner, shopId } = await createBookableShop(shopName, ['ulei']);
    const client = await createUser('client');
    const clientId = await userIdOf(client);
    const open = await booking(shopId, clientId, 'confirmed', dayFromNow(2));
    await serviceRest(`bookings?id=eq.${open.id}`, 'PATCH', { status: 'expired', closed_reason: 'not_updated' });

    await signIn(page, owner, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou/);
    await page.goto(`/s/istoric?q=${open.ref}`);
    await page.getByRole('button', { name: /Schimb ulei/ }).first().click();
    await expect(page.getByText('Încheiată automat după 7 zile fără actualizare. Clientul nu a fost trecut ca neprezentat.')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 'booking-auto-closed', name());
  });

  test("the admin's morning email, when something waits", async () => {
    // Something waits: a company in its ANAF deadline.
    const { shopId } = await createBookableShop(`Atelier Digest ${tag()}`, ['ulei']);
    await serviceRest(`shop_billing?shop_id=eq.${shopId}`, 'PATCH', { vat_id: '160796', anaf_problem_since: new Date().toISOString() });
    const before = (await emailsTo('admin@service-hub.test')).length;
    // A day of its own, far ahead, so the once-a-day rule never meets another run.
    const at = new Date(Date.now() + (400 + Math.floor(Math.random() * 3000)) * DAY).toISOString();
    expect(await serviceRest<boolean>('rpc/send_admin_digest', 'POST', { p_now: at })).toBe(true);
    await expect.poll(async () => (await emailsTo('admin@service-hub.test')).slice(before).map((m) => m.subject), { timeout: 20_000 }).toContainEqual(
      expect.stringMatching(/^Service-Hub: .+ te așteaptă azi$/),
    );
    const mail = (await emailsTo('admin@service-hub.test')).slice(before).find((m) => m.subject.startsWith('Service-Hub:'))!;
    expect(mail.text).toContain('Firme în termenul de corectare (ANAF)');
  });
});
