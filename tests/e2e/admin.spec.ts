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
  rpcAs,
  serviceRest,
  shot,
  signIn,
  userIdOf,
} from './support';

// T16a — the admin: overview, shops, clients, bookings, moderation, the audit log. Every action
// is checked where it matters (search, the booking, the review) and in the audit log.

const name = () => test.info().project.name;
const rid = () => crypto.randomUUID();
const tag = () => `${Date.now() % 1_000_000}${Math.floor(Math.random() * 100)}`;
const navLink = (page: Page, label: string | RegExp) =>
  page.getByRole('link', { name: label }).filter({ visible: true }).first();

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
  // The demo admin is shared by tests running in parallel: its saved language never changes.
  await page.route('**/rest/v1/profiles?*', (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue(),
  );
});

async function signInAdmin(page: Page) {
  await signIn(page, SEED.admin, SEED_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Prezentare' })).toBeVisible();
}

/** Whether a client finds the shop in search. */
async function inSearch(client: string, shopName: string): Promise<boolean> {
  const rows = await rpcAs<{ name: string }[]>(client, 'search_shops', { p_q: shopName });
  return rows.some((r) => r.name === shopName);
}

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

test.describe('admin', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test('overview and lists, in Romanian and English', async ({ page }) => {
    const shopName = `Atelier Admin ${tag()}`;
    await createBookableShop(shopName, ['ulei']);
    await signInAdmin(page);
    await expect(page.getByRole('heading', { name: 'Service-uri', level: 2 })).toBeVisible();
    await expect(page.getByText('Activitate recentă')).toBeVisible();
    await expect(page.getByText(shopName).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't16a-overview', name());

    await navLink(page, 'Service-uri').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Service-uri' })).toBeVisible();
    await page.getByLabel('Caută după nume, oraș, email, telefon sau S-00001').fill(shopName);
    await expect(page.getByRole('link', { name: new RegExp(shopName) })).toHaveCount(1);
    await expect(page).toHaveURL(/q=Atelier/);
    await page.getByRole('button', { name: 'Suspendate' }).click();
    await expect(page.getByText('Niciun rezultat pentru filtrele alese.')).toBeVisible();
    await page.getByRole('button', { name: 'Șterge filtrele' }).click();
    await expectNoHorizontalScroll(page);
    await shot(page, 't16a-shops', name());

    await navLink(page, /^Clienți/).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Clienți' })).toBeVisible();
    await expect(page.getByText('client@service-hub.test')).toBeVisible();
    await shot(page, 't16a-clients', name());

    await navLink(page, /^Rezervări/).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Rezervări' })).toBeVisible();
    await expect(page.getByText(/Afișate \d+ din \d+/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't16a-bookings', name());

    await navLink(page, /^Moderare/).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Moderare' })).toBeVisible();
    await expect(page.getByText('Toate recenziile')).toBeVisible();
    await shot(page, 't16a-moderation', name());

    await page.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Moderation' })).toBeVisible();
    await expect(page.getByText('All reviews')).toBeVisible();
    await navLink(page, /^Overview/).click();
    await expect(page.getByText('Monthly recurring revenue')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't16a-overview-en', name());
  });

  test('a shop: suspend, reactivate, extend, status, edit — each in the audit log', async ({ page }) => {
    const shopName = `Atelier Suspendat ${tag()}`;
    const { shopId } = await createBookableShop(shopName, ['ulei']);
    const client = await createUser('client');
    expect(await inSearch(client, shopName)).toBe(true);

    await signInAdmin(page);
    await page.goto(`/admin/service-uri/${shopId}`);
    await expect(page.getByRole('heading', { level: 1, name: shopName })).toBeVisible();
    await expect(page.getByText('Apare în căutări și primește programări.')).toBeVisible();
    await shot(page, 't16a-shop', name());

    // Suspend: a reason is required, the shop leaves search at once.
    await page.getByRole('button', { name: 'Suspendă service-ul' }).click();
    await page.getByRole('button', { name: 'Suspendă service-ul' }).click();
    await expect(page.getByText('Scrie motivul.')).toBeVisible();
    await page.getByLabel('Motiv').fill('Reclamații repetate');
    await expectNoHorizontalScroll(page);
    await shot(page, 't16a-shop-suspend', name());
    await page.getByRole('button', { name: 'Suspendă service-ul' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Service-ul este suspendat.' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Service-ul este suspendat.' })).toBeVisible();
    await expect(page.getByText('Nu apare în căutări:')).toBeVisible();
    expect(await inSearch(client, shopName)).toBe(false);

    await page.getByRole('button', { name: 'Reactivează service-ul' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Service-ul este reactivat.' })).toBeVisible();
    expect(await inSearch(client, shopName)).toBe(true);

    // Extend the free period by 30 days.
    await page.getByRole('button', { name: 'Prelungește perioada gratuită' }).click();
    await page.getByRole('button', { name: 'Prelungește cu 30 de zile' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Perioada gratuită este prelungită.' })).toBeVisible();

    // Stop the subscription by hand: out of search; then active again.
    await page.getByRole('button', { name: 'Schimbă statusul abonamentului' }).click();
    await page.getByRole('button', { name: 'Inactiv', exact: true }).click();
    await page.getByRole('button', { name: 'Setează „Inactiv”' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Statusul abonamentului este schimbat.' })).toBeVisible();
    expect(await inSearch(client, shopName)).toBe(false);
    await page.getByRole('button', { name: 'Schimbă statusul abonamentului' }).click();
    await page.getByRole('button', { name: 'Activ', exact: true }).click();
    await page.getByRole('button', { name: 'Setează „Activ”' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Statusul abonamentului este schimbat.' })).toBeVisible();
    expect(await inSearch(client, shopName)).toBe(true);

    // Edit: an invalid IBAN is named; a valid change is saved.
    await page.getByRole('button', { name: 'Editează datele' }).click();
    await page.getByLabel('IBAN').fill('RO00 XXXX');
    await page.getByRole('button', { name: 'Salvează' }).click();
    await expect(page.getByText('Verifică câmpul „IBAN”: valoarea nu este validă.')).toBeVisible();
    await page.getByLabel('IBAN').fill('');
    await page.getByLabel('Mașini pe zi').fill('7');
    await expectNoHorizontalScroll(page);
    await shot(page, 't16a-shop-edit', name());
    await page.getByRole('button', { name: 'Salvează' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Datele sunt salvate.' })).toBeVisible();
    const [row] = await serviceRest<{ daily_capacity: number }[]>(`shops?id=eq.${shopId}&select=daily_capacity`, 'GET');
    expect(row!.daily_capacity).toBe(7);

    // Every action, with before and after, on the shop and in the log.
    const audit = page.locator('main ul').last();
    for (const action of ['Service suspendat', 'Service reactivat', 'Perioadă gratuită prelungită', 'Status abonament schimbat', 'Date service modificate']) {
      await expect(audit.getByText(action, { exact: true }).first()).toBeVisible();
    }
    await expect(audit.getByText('Mașini pe zi:')).toBeVisible();
    await expect(audit.getByText(/Mașini pe zi: 5\s*→\s*devine\s*7/)).toBeVisible();
    await expect(audit.getByText('Reclamații repetate')).toBeVisible();
    await shot(page, 't16a-shop-audit', name());

    await openAccount(page);
    await page.getByRole('link', { name: /Jurnal de audit/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Jurnal de audit' })).toBeVisible();
    await expect(page.getByRole('link', { name: shopName }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't16a-audit', name());
  });

  test('a booking: found by its code, force-canceled with a reason, conversation read-only', async ({ page }) => {
    const { email: shop, shopId } = await createBookableShop(`Atelier Anulare ${tag()}`, ['ulei']);
    const client = await createUser('client');
    const at = await freeSlot(client, shopId);
    const booking = await rpcAs<{ id: string; ref: string }>(client, 'create_booking', {
      p_shop_id: shopId,
      p_service_id: 'ulei',
      p_date: at.date,
      p_slot: at.slot,
      p_request_id: rid(),
      p_car: { make: 'Dacia', model: 'Logan', year: 2019, plate: 'BV 44 KLM' },
      p_save_car: false,
    });
    await rpcAs(shop, 'confirm_booking', { p_booking_id: booking.id, p_request_id: rid() });

    await signInAdmin(page);
    await navLink(page, /^Rezervări/).click();
    await page.getByLabel('Caută după cod, număr, client sau service').fill(booking.ref);
    await expect(page.getByText('Afișate 1 din 1')).toBeVisible();
    await page.getByRole('link', { name: new RegExp(booking.ref) }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Schimb ulei/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Conversația' })).toBeVisible();

    await page.getByRole('button', { name: 'Anulează rezervarea' }).click();
    await page.getByLabel('Motivul anulării').fill('Service închis temporar');
    await shot(page, 't16a-booking-cancel', name());
    await page.getByRole('button', { name: 'Anulează rezervarea' }).click();
    await expect(page.getByText('Rezervarea este anulată. Ambele părți sunt anunțate.')).toBeVisible();
    await expect(page.getByText('Echipa Service-Hub', { exact: true })).toBeVisible();
    await expect(page.getByText('Rezervare anulată', { exact: true })).toBeVisible();
    const [b] = await serviceRest<{ status: string; cancelled_by: string }[]>(`bookings?id=eq.${booking.id}&select=status,cancelled_by`, 'GET');
    expect(b).toEqual({ status: 'cancelled', cancelled_by: 'admin' });
    await expectNoHorizontalScroll(page);
    await shot(page, 't16a-booking', name());

    await page.getByRole('link', { name: 'Deschide conversația' }).click();
    await expect(page.getByText('Doar citire. Adminul nu scrie în conversații.')).toBeVisible();
    await expect(page.getByText(`Programarea ${booking.ref} a fost anulată de echipa Service-Hub.`)).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await shot(page, 't16a-thread', name());
  });

  test('moderation: a reported review is removed and leaves the average', async ({ page }) => {
    const { email: shop, shopId } = await createBookableShop(`Atelier Recenzie ${tag()}`, ['ulei']);
    const client = await createUser('client');
    const clientId = await userIdOf(client);
    const text = `Recenzie de test ${tag()}`;
    const [booking] = await serviceRest<{ id: string }[]>('bookings', 'POST', {
      shop_id: shopId,
      client_id: clientId,
      service_id: 'ulei',
      client_name: 'Maria Pop',
      date: '2026-01-10',
      slot: '10:00',
      status: 'done',
      done_at: new Date().toISOString(),
    });
    const [review] = await serviceRest<{ id: string }[]>('reviews', 'POST', {
      booking_id: booking!.id,
      shop_id: shopId,
      client_id: clientId,
      client_display_name: 'Maria P.',
      rating: 1,
      text,
    });
    await rpcAs(shop, 'report_review', { p_review_id: review!.id, p_reason: 'abusive', p_request_id: rid() });

    await signInAdmin(page);
    // The badge on Moderare counts the reports waiting.
    await expect(navLink(page, /^Moderare\s*,\s*(\d+ (de )?recenzii raportate|o recenzie raportată)$/)).toBeVisible();
    await navLink(page, /^Moderare/).click();
    const card = page.locator('main li').filter({ hasText: text }).first();
    await expect(card.getByText('Limbaj abuziv')).toBeVisible();
    await expect(card.getByText(/Așteaptă de/)).toBeVisible();
    await card.getByRole('button', { name: 'Șterge' }).click();
    await card.getByLabel('Notă (opțional)').fill('Insultă');
    await expectNoHorizontalScroll(page);
    await shot(page, 't16a-moderation-remove', name());
    await card.getByRole('button', { name: 'Șterge' }).click();
    await expect(page.getByText('Decizia este salvată. Părțile sunt anunțate.')).toBeVisible();

    // Out of the queue; in the list as removed, with the note.
    const listed = page.locator('main li').filter({ hasText: text });
    await expect(listed).toHaveCount(1);
    await expect(listed.getByText('Ștearsă')).toBeVisible();
    await expect(listed.getByText('Notă: Insultă')).toBeVisible();
    const [rating] = await serviceRest<{ review_count: number }[]>(`shop_ratings?shop_id=eq.${shopId}`, 'GET');
    expect(rating!.review_count).toBe(0);
    const told = await serviceRest<{ user_id: string }[]>(
      `notification_events?event=eq.review_report_decided&booking_id=eq.${booking!.id}&select=user_id`,
      'GET',
    );
    expect(told.map((e) => e.user_id)).toContain(clientId);
    expect(told.length).toBe(2);
    await shot(page, 't16a-moderation-done', name());
  });

  test('a client: suspend, reactivate, delete', async ({ page }) => {
    const client = await createUser('client');
    const clientId = await userIdOf(client);
    await signInAdmin(page);
    await navLink(page, /^Clienți/).click();
    await page.getByLabel('Caută după nume, email, telefon sau C-00001').fill(client);
    await page.getByRole('link', { name: new RegExp(client.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Maria Pop' })).toBeVisible();

    await page.getByRole('button', { name: 'Suspendă contul' }).click();
    await page.getByLabel('Motiv').fill('Programări false');
    await page.getByRole('button', { name: 'Suspendă contul' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Contul este suspendat.' })).toBeVisible();
    const [p] = await serviceRest<{ suspended: boolean }[]>(`profiles?id=eq.${clientId}&select=suspended`, 'GET');
    expect(p!.suspended).toBe(true);
    await expectNoHorizontalScroll(page);
    await shot(page, 't16a-client', name());
    await page.getByRole('button', { name: 'Reactivează contul' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Contul este reactivat.' })).toBeVisible();

    await page.getByRole('button', { name: 'Șterge contul' }).click();
    await page.getByRole('button', { name: 'Șterge definitiv' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Clienți' })).toBeVisible();
    const gone = await fetch(`${process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: client, password: PASSWORD }),
    });
    expect(gone.ok).toBe(false);
    const log = await serviceRest<{ action: string }[]>(`admin_audit_log?entity_id=eq.${clientId}&select=action`, 'GET');
    expect(log.map((l) => l.action).sort()).toEqual(['delete_account', 'suspend_account', 'unsuspend_account']);
  });

  test('only the admin reaches the admin screens', async ({ page }) => {
    await signIn(page, SEED.client, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await page.goto('/admin/service-uri');
    await expect(page).toHaveURL(/\/c\/cauta/);
    const res = await fetch(`${process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SEED.client, password: SEED_PASSWORD }),
    });
    const token = ((await res.json()) as { access_token: string }).access_token;
    const denied = await fetch(`${process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'}/rest/v1/rpc/admin_list_clients`, {
      method: 'POST',
      headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY ?? '', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(denied.ok).toBe(false);
    expect(((await denied.json()) as { message: string }).message).toBe('not_allowed');
  });
});
