import { expect, test } from '@playwright/test';
import { fleetSetup, openAs } from './fleet-support';
import { BACKEND, SEED, SEED_PASSWORD, bucharestDay, createBookableShop, expectNoHorizontalScroll, expectNoRomanianText, rpcAs, serviceRest, shot, signIn, uniquePlate, userIdOf, openClientBooking
} from './support';

// T72–T77 — the fleet stages in the browser: issues and incidents (M3), odometer and fuel (M2), quote
// changes and the manager's cancel (M5), maintenance (M4), notifications (M6), amounts hidden from a
// driver without costs.view (107). The database rules are in tests/sql/144–149.

const name = () => test.info().project.name;
// A 1×1 PNG: a photo the bucket accepts.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.describe('M3 — issues and incidents', () => {
  test.describe.configure({ timeout: 120_000 });
  test('the driver reports an issue with a photo; the manager schedules it; the history shows both', async ({ browser }) => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    const f = await fleetSetup();
    const vehiclePage = `/c/firme/${f.company}?sectiune=vehicul&vehicul=${f.vehicle}`;

    const driver = await openAs(browser, f.driver, 'ro', vehiclePage);
    await driver.getByRole('button', { name: 'Raportează o problemă' }).first().click();
    await driver.getByRole('combobox', { name: 'Tip' }).selectOption('damage');
    await driver.getByLabel('Titlu').fill('Zgârietură pe ușa din spate');
    await driver.getByLabel('Descriere').fill('Parcarea clientului, ieri seară.');
    await driver.getByLabel('Fotografii').setInputFiles({ name: 'usa.png', mimeType: 'image/png', buffer: PNG });
    await expect(driver.getByText('1 fotografie', { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(driver);
    await shot(driver, 'issue-form', name());
    await driver.getByRole('button', { name: 'Trimite raportul' }).click();
    const row = driver.locator('li').filter({ hasText: 'Zgârietură pe ușa din spate' });
    await expect(row).toContainText('Avarie');
    await expect(row).toContainText('Nouă');
    await shot(driver, 'issue-list-driver', name());
    const [saved] = await serviceRest<{ id: string; photos: string[]; status: string }[]>(`fleet_issues?company_id=eq.${f.company}&select=id,photos,status`, 'GET');
    expect(saved!.photos).toHaveLength(1);
    expect(saved!.photos[0]).toMatch(new RegExp(`^${f.company}/${f.vehicle}/issues/${saved!.id}/`));
    // No follow-up for a driver.
    await row.getByRole('button', { name: 'Zgârietură pe ușa din spate' }).click();
    await expect(driver.getByRole('heading', { name: 'Istoricul raportului' })).toBeVisible();
    await expect(driver.getByRole('heading', { name: 'Urmărire' })).toHaveCount(0);
    await driver.context().close();

    const manager = await openAs(browser, f.manager, 'en', `${vehiclePage}`);
    await manager.getByRole('combobox', { name: 'Vehicle sections' }).selectOption('notes');
    await manager.getByRole('button', { name: 'Zgârietură pe ușa din spate' }).click();
    await expect(manager.getByText('Damage', { exact: false }).first()).toBeVisible();
    await manager.getByRole('combobox', { name: 'Status' }).selectOption('in_review');
    await manager.getByLabel('Note').fill('Waiting for the insurer.');
    await manager.getByRole('button', { name: 'Save' }).click();
    await expect(manager.getByRole('status').filter({ hasText: 'The report was saved.' })).toBeVisible();
    await expect(manager.getByText('Status: New → In review')).toBeVisible();
    await expect(manager.getByText('Waiting for the insurer.')).toBeVisible();
    await expectNoHorizontalScroll(manager);
    await expectNoRomanianText(manager, 'issue detail');
    await shot(manager, 'issue-detail-manager', name());
    await manager.context().close();

    const [after] = await serviceRest<{ status: string }[]>(`fleet_issues?company_id=eq.${f.company}&select=status`, 'GET');
    expect(after!.status).toBe('in_review');
  });

  test('the accountant reads reports but has no follow-up and no report button', async ({ browser }) => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    const f = await fleetSetup();
    await rpcAs(f.driver, 'fleet_report_issue', {
      p_company: f.company,
      p_issue: crypto.randomUUID(),
      p_fields: { vehicle_id: f.vehicle, kind: 'defect', title: 'Bec far stânga ars', happened_on: new Date().toISOString().slice(0, 10) },
      p_request_id: crypto.randomUUID(),
    });
    const page = await openAs(browser, f.accountant, 'ro', `/c/firme/${f.company}?sectiune=vehicul&vehicul=${f.vehicle}`);
    await expect(page.getByRole('button', { name: 'Raportează o problemă' })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Secțiunile vehiculului' }).selectOption('notes');
    await page.getByRole('button', { name: 'Bec far stânga ars' }).click();
    await expect(page.getByRole('heading', { name: 'Istoricul raportului' })).toBeVisible();
    await expect(page.getByText('Raport trimis')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Urmărire' })).toHaveCount(0);
    await page.context().close();
  });
});

test.describe('M2 — odometer and fuel', () => {
  test.describe.configure({ timeout: 120_000 });

  test('readings follow the rule; a correction needs a reason; consumption between two full tanks', async ({ browser }) => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    const f = await fleetSetup();
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    // Two full-tank fills by the driver, 500 km apart: 30 l → 6 l/100 km.
    for (const [d, km, liters] of [
      [3, 100000, 40],
      [1, 100500, 30],
    ] as const) {
      await rpcAs(f.driver, 'fleet_save_expense', {
        p_company: f.company,
        p_expense: null,
        p_fields: { vehicle_id: f.vehicle, category: 'fuel', day: day(d), amount: 300, odometer: km, liters, fuel_type: 'diesel', full_tank: true, supplier: `Petrom ${km}` },
        p_request_id: crypto.randomUUID(),
      });
    }

    const page = await openAs(browser, f.manager, 'ro', `/c/firme/${f.company}?sectiune=vehicul&vehicul=${f.vehicle}`);
    await expect(page.getByText('100.500 km').first()).toBeVisible();
    await page.getByRole('combobox', { name: 'Secțiunile vehiculului' }).selectOption('odometer');
    await expect(page.getByText('6 l/100 km')).toBeVisible();

    // A reading lower than an earlier one is refused with the reason.
    await page.getByRole('button', { name: 'Adaugă citire' }).click();
    await page.getByLabel('Kilometraj', { exact: true }).fill('99000');
    await page.getByRole('button', { name: 'Salvează citirea' }).click();
    await expect(page.getByText('Ultima valoare înregistrată a fost', { exact: false })).toBeVisible();
    await page.getByLabel('Kilometraj', { exact: true }).fill('100700');
    await page.getByRole('button', { name: 'Salvează citirea' }).click();
    const row = page.locator('li').filter({ hasText: '100.700 km' });
    await expect(row).toContainText('Citire introdusă');

    // A correction with a reason.
    await row.getByRole('button', { name: 'Corectează' }).click();
    await page.getByLabel('Kilometraj corect').fill('100650');
    await page.getByRole('button', { name: 'Salvează corecția' }).click();
    await expect(page.getByText('Motivul are cel puțin 3 caractere.')).toBeVisible();
    await page.getByLabel('Motiv').fill('Cifră citită greșit');
    await page.getByRole('button', { name: 'Salvează corecția' }).click();
    await expect(page.locator('li').filter({ hasText: '100.650 km' })).toContainText('corectat de la 100.700 km: Cifră citită greșit');
    await expectNoHorizontalScroll(page);
    await shot(page, 'odometer-manager', name());
    await page.context().close();

    // The driver: consumption without money, adds a reading, never corrects.
    const driver = await openAs(browser, f.driver, 'en', `/c/firme/${f.company}?sectiune=vehicul&vehicul=${f.vehicle}`);
    await driver.getByRole('combobox', { name: 'Vehicle sections' }).selectOption('odometer');
    await expect(driver.getByText('6 l/100 km')).toBeVisible();
    await expect(driver.getByText('Fuel cost per km')).toHaveCount(0);
    await expect(driver.getByRole('button', { name: 'Correct' })).toHaveCount(0);
    await expect(driver.getByRole('button', { name: 'Add reading' })).toBeVisible();
    await expectNoRomanianText(driver, 'odometer');
    await shot(driver, 'odometer-driver-en', name());
    await driver.context().close();
  });
});

/** A weekday at least `n` days ahead (the shop is open Monday to Friday). */
function weekday(n: number): string {
  let d = n;
  while ([0, 6].includes(new Date(`${bucharestDay(d)}T12:00:00Z`).getUTCDay())) d += 1;
  return bucharestDay(d);
}

test.describe('M5 — quote changes and the manager\'s cancel', () => {
  test.describe.configure({ timeout: 150_000 });

  test('the manager cancels a confirmed booking with a reason and asks for changes to a quote', async ({ browser }) => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    const f = await fleetSetup();
    const { email: shop, shopId } = await createBookableShop(`Atelier Etape ${Date.now()}`, ['ulei']);
    const second = await rpcAs<{ id: string }>(f.admin, 'fleet_save_vehicle', {
      p_company: f.company,
      p_vehicle: null,
      p_fields: { make: 'Ford', model: 'Transit', plate: uniquePlate('B') },
      p_request_id: crypto.randomUUID(),
    });
    const book = (email: string, vehicle: string, day: string) =>
      rpcAs<{ id: string; ref: string }>(email, 'create_booking', {
        p_shop_id: shopId,
        p_service_id: 'ulei',
        p_date: day,
        p_slot: '10:00',
        p_request_id: crypto.randomUUID(),
        p_company_vehicle_id: vehicle,
      });
    const dayA = weekday(7);
    const a = await book(f.driver, f.vehicle, dayA);
    await rpcAs(shop, 'confirm_booking', { p_booking_id: a.id, p_request_id: crypto.randomUUID() });
    // Another day than the first booking (on a weekend, weekday(7) and weekday(8) are the same Monday).
    let n = 8;
    while (weekday(n) === dayA) n += 1;
    const b = await book(f.admin, second.id, weekday(n));
    await rpcAs(shop, 'confirm_booking', { p_booking_id: b.id, p_request_id: crypto.randomUUID() });
    await rpcAs(shop, 'start_inspection', { p_booking_id: b.id, p_request_id: crypto.randomUUID() });
    await rpcAs(shop, 'send_quote', {
      p_booking_id: b.id,
      p_items: [
        { name: 'Plăcuțe', price: 420 },
        { name: 'Manoperă', price: 180 },
      ],
      p_request_id: crypto.randomUUID(),
    });

    const page = await openAs(browser, f.manager, 'ro', `/c/firme/${f.company}?sectiune=programari`);
    // The quote: „Cere modificări”, with a reason; the quote stays open.
    const quoteCard = page.locator('article, section, div').filter({ hasText: b.ref }).filter({ has: page.getByRole('button', { name: 'Cere modificări' }) }).last();
    await quoteCard.getByRole('button', { name: 'Cere modificări' }).click();
    await page.getByRole('button', { name: 'Trimite cererea' }).click();
    await expect(page.getByText('Motivul are cel puțin 3 caractere.')).toBeVisible();
    await page.getByLabel('Ce trebuie modificat').fill('Fără manopera de diagnoză');
    await page.getByRole('button', { name: 'Trimite cererea' }).click();
    await expect(page.getByText('Cererea de modificare a fost trimisă.')).toBeVisible();
    const [decision] = await serviceRest<{ decision: string; reason: string }[]>(`company_quote_decisions?booking_id=eq.${b.id}&select=decision,reason`, 'GET');
    expect(decision).toEqual({ decision: 'changes_requested', reason: 'Fără manopera de diagnoză' });

    // The confirmed booking: „Anulează programarea”, after an inline confirm with a reason.
    const card = page.locator('div').filter({ hasText: a.ref }).filter({ has: page.getByRole('button', { name: 'Anulează programarea' }) }).last();
    await card.getByRole('button', { name: 'Anulează programarea' }).click();
    await expect(page.getByText(`Anulezi programarea ${a.ref}?`)).toBeVisible();
    await page.getByRole('textbox', { name: 'Motiv' }).fill('Vehiculul nu mai este disponibil');
    await expectNoHorizontalScroll(page);
    await shot(page, 'm5-cancel-confirm', name());
    await page.getByRole('group').getByRole('button', { name: 'Anulează programarea' }).click();
    await expect.poll(async () => (await serviceRest<{ status: string; cancel_reason: string }[]>(`bookings?id=eq.${a.id}&select=status,cancel_reason`, 'GET'))[0]).toEqual({
      status: 'cancelled',
      cancel_reason: 'Vehiculul nu mai este disponibil',
    });
    await page.context().close();

    // The driver of the vehicle cannot cancel company bookings here (no quotes.approve).
    const driver = await openAs(browser, f.driver, 'en', `/c/firme/${f.company}?sectiune=programari`);
    await expect(driver.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(driver.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0);
    await expect(driver.getByRole('button', { name: 'Request changes' })).toHaveCount(0);
    await driver.context().close();
  });
});

test.describe('M4 — maintenance', () => {
  test.describe.configure({ timeout: 120_000 });

  test('an item without a reading is never ok; marked done it is; the driver only reads it', async ({ browser }) => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    const f = await fleetSetup();
    const page = await openAs(browser, f.manager, 'ro', `/c/firme/${f.company}?sectiune=vehicul&vehicul=${f.vehicle}`);
    await page.getByRole('combobox', { name: 'Secțiunile vehiculului' }).selectOption('maintenance');
    await page.getByRole('button', { name: 'Adaugă element' }).click();
    await page.getByRole('combobox', { name: 'Element' }).selectOption('oil');
    await page.getByLabel('Interval (km)').fill('10000');
    await page.getByLabel('Interval (luni)').fill('12');
    await page.getByLabel('Kilometraj la ultima efectuare').fill('50000');
    await page.getByRole('button', { name: 'Salvează elementul' }).click();
    const row = page.locator('li').filter({ hasText: 'Ulei și filtru' });
    await expect(row).toContainText('Date insuficiente');
    await expect(row).toContainText('Lipsește data ultimei efectuări');

    await row.getByRole('button', { name: 'Mai multe' }).click();
    await page.getByRole('menuitem', { name: 'Marchează efectuat' }).click();
    await page.getByLabel('Kilometraj', { exact: true }).fill('52000');
    await page.getByRole('button', { name: 'Marchează efectuat' }).last().click();
    await expect(row).toContainText('În regulă');
    await expect(row).toContainText('Mai sunt 10.000 km');
    await expectNoHorizontalScroll(page);
    await shot(page, 'maintenance-manager', name());
    await page.context().close();

    const driver = await openAs(browser, f.driver, 'en', `/c/firme/${f.company}?sectiune=vehicul&vehicul=${f.vehicle}`);
    await driver.getByRole('combobox', { name: 'Vehicle sections' }).selectOption('maintenance');
    await expect(driver.locator('li').filter({ hasText: 'Oil and filter' })).toContainText('OK');
    await expect(driver.getByRole('button', { name: 'Add item' })).toHaveCount(0);
    await expect(driver.getByRole('button', { name: 'More' })).toHaveCount(0);
    await expectNoRomanianText(driver, 'maintenance');
    await driver.context().close();
  });
});

test.describe('M6 — fleet notifications', () => {
  test.describe.configure({ timeout: 180_000 });

  test('an issue reaches the managers through the outbox; the driver who reported gets nothing', async () => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    const f = await fleetSetup();
    await rpcAs(f.driver, 'fleet_report_issue', {
      p_company: f.company,
      p_issue: crypto.randomUUID(),
      p_fields: { vehicle_id: f.vehicle, kind: 'damage', title: 'Oglindă spartă', happened_on: bucharestDay(0) },
      p_request_id: crypto.randomUUID(),
    });
    const [admin, manager, driver] = await Promise.all([userIdOf(f.admin), userIdOf(f.manager), userIdOf(f.driver)]);
    // pg_cron runs the worker every minute.
    await expect
      .poll(async () => (await serviceRest<{ user_id: string }[]>(`notification_events?event=eq.fleet_issue_reported&user_id=in.(${admin},${manager},${driver})&select=user_id`, 'GET')).length, {
        timeout: 150_000,
        intervals: [5_000],
      })
      .toBe(2);
    const rows = await serviceRest<{ user_id: string; params: Record<string, unknown> }[]>(
      `notification_events?event=eq.fleet_issue_reported&user_id=in.(${admin},${manager},${driver})&select=user_id,params`,
      'GET',
    );
    expect(rows.map((r) => r.user_id).sort()).toEqual([admin, manager].sort());
    expect(rows[0]!.params).toMatchObject({ company_id: f.company, title: 'Oglindă spartă', plate: f.plate });
  });

  test('a role changed elsewhere: the open fleet space reads again by itself', async ({ browser }) => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    const f = await fleetSetup();
    const page = await openAs(browser, f.manager, 'ro', `/c/firme/${f.company}?sectiune=panou`);
    await expect(page.getByText(/· Manager de flotă$/)).toBeVisible();
    const [member] = await serviceRest<{ id: string }[]>(`company_members?company_id=eq.${f.company}&role=eq.manager&select=id`, 'GET');
    await rpcAs(f.admin, 'set_company_member_role', { p_member: member!.id, p_role: 'driver', p_request_id: crypto.randomUUID() });
    // No reload: the rights version arrives through Realtime and the space is read again.
    await expect(page.getByText(/· Șofer$/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/· Manager de flotă$/)).toHaveCount(0);
    await page.context().close();
  });

  test('the admin sees a failed fleet event without its data and retries it', async ({ browser }) => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    const f = await fleetSetup();
    await serviceRest('fleet_events', 'POST', {
      company_id: f.company,
      event: 'fleet_doc_expiring',
      entity_id: f.vehicle,
      data: { doc: 'itp', expiry: 'not a date' },
      event_key: `poison:${crypto.randomUUID()}`,
      attempts: 24,
      failed_at: new Date().toISOString(),
      last_error_code: '22007',
      last_error: 'invalid input syntax for type date',
    });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    await signIn(page, SEED.admin, SEED_PASSWORD);
    await page.goto('/admin/platforma/notificari-flota');
    const row = page.locator('li').filter({ hasText: 'Document care expiră' }).filter({ hasText: /Etape \d+/ }).first();
    await expect(row).toContainText('22007');
    await expect(page.getByText('invalid input syntax')).toHaveCount(0);
    await expect(page.getByText(f.plate)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, 'admin-fleet-failed', name());
    await row.getByRole('button', { name: 'Încearcă din nou' }).click();
    await expect.poll(async () => (await serviceRest<{ failed_at: string | null }[]>(`fleet_events?company_id=eq.${f.company}&select=failed_at`, 'GET'))[0]!.failed_at).toBeNull();
    await ctx.close();
  });
});

test.describe('107 — amounts hidden from a driver without costs.view', () => {
  test.describe.configure({ timeout: 150_000 });

  test('the driver who booked sees the company booking in Programări without any amount; the manager sees them', async ({ browser }) => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    const f = await fleetSetup();
    const { email: shop, shopId } = await createBookableShop(`Atelier Sume ${Date.now()}`, ['ulei']);
    const b = await rpcAs<{ id: string; ref: string }>(f.driver, 'create_booking', {
      p_shop_id: shopId,
      p_service_id: 'ulei',
      p_date: weekday(9),
      p_slot: '10:00',
      p_request_id: crypto.randomUUID(),
      p_company_vehicle_id: f.vehicle,
    });
    await rpcAs(shop, 'confirm_booking', { p_booking_id: b.id, p_request_id: crypto.randomUUID() });
    await rpcAs(shop, 'start_inspection', { p_booking_id: b.id, p_request_id: crypto.randomUUID() });
    await rpcAs(shop, 'send_quote', {
      p_booking_id: b.id,
      p_items: [
        { name: 'Plăcuțe', price: 420 },
        { name: 'Manoperă', price: 180 },
      ],
      p_request_id: crypto.randomUUID(),
    });
    const [quote] = await serviceRest<{ id: string }[]>(`quotes?booking_id=eq.${b.id}&status=eq.sent&select=id`, 'GET');
    const items = await serviceRest<{ id: string }[]>(`quote_items?quote_id=eq.${quote!.id}&select=id`, 'GET');
    await rpcAs(f.manager, 'fleet_decide_quote', { p_booking_id: b.id, p_quote_id: quote!.id, p_approved_item_ids: items.map((i) => i.id), p_request_id: crypto.randomUUID() });

    const driver = await openAs(browser, f.driver, 'ro', '/c/programari');
    const card = await openClientBooking(driver, b.ref);
    await expect(card).toContainText('Devizul a fost aprobat de firmă.');
    // The total as a number of its own: the shop's name (a timestamp) or the booking code may contain
    // the digits 600 (A7: the test failed on „Atelier Sume 1794497150600”).
    await expect(card).not.toContainText(/(?<!\d)600(?!\d)/);
    await expect(card).not.toContainText(/\d\s?lei/);
    await expect(card.getByRole('button', { name: 'Deviz (PDF)' })).toHaveCount(0);
    await expectNoHorizontalScroll(driver);
    await shot(driver, '107-driver-bookings', name());
    // The thread: the automatic messages name no amount either.
    const [msg] = await serviceRest<{ params: Record<string, unknown> }[]>(`messages?booking_id=eq.${b.id}&event=eq.quote_sent&select=params`, 'GET');
    expect(msg!.params).not.toHaveProperty('total');
    await driver.context().close();

    const manager = await openAs(browser, f.manager, 'ro', `/c/firme/${f.company}?sectiune=programari`);
    await expect(manager.locator('div').filter({ hasText: b.ref }).last()).toContainText(/(?<!\d)600(?!\d)/);
    await manager.context().close();
  });
});
