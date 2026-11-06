import { expect, test, type Browser, type Page } from '@playwright/test';
import { BACKEND, PASSWORD, bucharestDay, createBookableShop, createFleetUser, expectNoHorizontalScroll, expectNoRomanianText, rpcAs, serviceRest, shot, signIn, uniquePlate, userIdOf } from './support';

// T72–T77 — the fleet stages in the browser: issues and incidents (M3), odometer and fuel (M2), quote
// changes and the manager's cancel (M5), maintenance (M4), notifications (M6), amounts hidden from a
// driver without costs.view (107). The database rules are in tests/sql/144–149.

const name = () => test.info().project.name;
// A 1×1 PNG: a photo the bucket accepts.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export interface Fleet {
  admin: string;
  manager: string;
  driver: string;
  accountant: string;
  company: string;
  vehicle: string;
  plate: string;
}

const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

/** A company on Fleet Business: admin, manager, accountant, a driver assigned to one vehicle. */
export async function fleetSetup(): Promise<Fleet> {
  const [admin, manager, driver, accountant] = await Promise.all([createFleetUser(), createFleetUser(), createFleetUser(), createFleetUser()]);
  const company = await rpcAs<{ id: string }>(admin, 'create_company', {
    p_name: `Etape ${Date.now()}`,
    p_vat_id: null,
    p_reg_com: null,
    p_address: null,
    p_request_id: crypto.randomUUID(),
  });
  for (const [email, role] of [
    [manager, 'manager'],
    [driver, 'driver'],
    [accountant, 'accountant'],
  ] as const) {
    const tk = token();
    await rpcAs(admin, 'invite_company_member', { p_company: company.id, p_email: email, p_role: role, p_token: tk, p_request_id: crypto.randomUUID() });
    await rpcAs(email, 'accept_company_invite', { p_token: tk, p_request_id: crypto.randomUUID() });
  }
  const plate = uniquePlate('B');
  const vehicle = await rpcAs<{ id: string }>(admin, 'fleet_save_vehicle', {
    p_company: company.id,
    p_vehicle: null,
    p_fields: { make: 'Dacia', model: 'Logan', plate },
    p_request_id: crypto.randomUUID(),
  });
  const members = await serviceRest<{ id: string }[]>(`company_members?company_id=eq.${company.id}&role=eq.driver&select=id`, 'GET');
  await rpcAs(admin, 'fleet_assign_driver', { p_vehicle: vehicle.id, p_member: members[0]!.id, p_request_id: crypto.randomUUID() });
  await serviceRest(`company_subscriptions?company_id=eq.${company.id}`, 'PATCH', { plan_key: 'fleet_business' });
  return { admin, manager, driver, accountant, company: company.id, vehicle: vehicle.id, plate };
}

/** Signed in (the sign-in page in Romanian); the profile's language then applies, as on any device. */
export async function openAs(browser: Browser, email: string, lang: 'ro' | 'en', path: string): Promise<Page> {
  await serviceRest(`profiles?id=eq.${await userIdOf(email)}`, 'PATCH', { lang });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  await page.goto(path);
  return page;
}

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
    await expect(manager.getByRole('status')).toHaveText('The report was saved.');
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
    const a = await book(f.driver, f.vehicle, weekday(7));
    await rpcAs(shop, 'confirm_booking', { p_booking_id: a.id, p_request_id: crypto.randomUUID() });
    const b = await book(f.admin, second.id, weekday(8));
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
