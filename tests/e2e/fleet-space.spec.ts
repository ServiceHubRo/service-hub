import { expect, test, type Page } from '@playwright/test';
import { BACKEND, PASSWORD, SEED, SEED_PASSWORD, createBookableShop, createFleetUser, expectNoHorizontalScroll, rpcAs, serviceRest, shot, signIn, uniquePlate } from './support';

// The company's fleet space (T63c): the admin opens the fleet from the company page, adds a vehicle
// with the form (a plate already in the fleet is refused), assigns it to the driver, archives
// another; the driver opens the same fleet and sees only the vehicle assigned to them, without
// money or the add button. Its own frame: top bar with the language, the five fleet pages.

const name = () => test.info().project.name;

/** The vehicle's sections: a dropdown on phones and tablets, tabs on a laptop. */
async function openVehicleSection(page: Page, label: string) {
  const select = page.getByRole('combobox', { name: 'Secțiunile vehiculului' });
  const tab = page.getByRole('button', { name: new RegExp(label) });
  // Wait for the vehicle page: one of the two is on screen once it is drawn.
  await expect(select.or(tab).filter({ visible: true }).first()).toBeVisible();
  if (await select.isVisible()) await select.selectOption({ label });
  else await tab.click();
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

test('admin adds and assigns vehicles; the driver sees only theirs', async ({ page, browser }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  const admin = await createFleetUser();
  const driver = await createFleetUser();
  const company = await rpcAs<{ id: string }>(admin, 'create_company', {
    p_name: 'Flota Test SRL',
    p_vat_id: null,
    p_reg_com: null,
    p_address: null,
    p_request_id: crypto.randomUUID(),
  });
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  await rpcAs(admin, 'invite_company_member', { p_company: company.id, p_email: driver, p_role: 'driver', p_token: token, p_request_id: crypto.randomUUID() });
  await rpcAs(driver, 'accept_company_invite', { p_token: token, p_request_id: crypto.randomUUID() });
  const plate1 = uniquePlate('B');
  const plate2 = uniquePlate('B');
  await rpcAs(admin, 'fleet_save_vehicle', {
    p_company: company.id,
    p_vehicle: null,
    p_fields: { make: 'Ford', model: 'Transit', plate: plate2, vehicle_type: 'van' },
    p_request_id: crypto.randomUUID(),
  });

  // The admin opens the fleet from the company page.
  await signIn(page, admin, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  await page.goto(`/c/cont/firme/${company.id}`);
  await page.getByRole('link', { name: 'Deschide flota' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Panou' })).toBeVisible();
  await expect(page.getByText('Vehicule în flotă')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'fleet-live-dashboard', name());

  // Adds a vehicle with the form; the plate of the Transit is refused.
  await page.getByRole('button', { name: 'Vehicule' }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Adaugă vehicul' }).click();
  await page.getByLabel('Marcă').fill('Dacia');
  await page.getByLabel('Model', { exact: true }).fill('Logan');
  await page.getByLabel('Nr. înmatriculare').fill(plate2);
  await page.getByRole('button', { name: 'Salvează vehiculul' }).click();
  await expect(page.getByText('Un vehicul activ al firmei are deja acest număr de înmatriculare.')).toBeVisible();
  await page.getByLabel('Nr. înmatriculare').fill(plate1);
  await page.getByRole('button', { name: 'Salvează vehiculul' }).click();
  await expect(page.getByRole('heading', { level: 2, name: plate1 })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Assigns it to the driver.
  await openVehicleSection(page, 'Șofer și responsabil');
  await page.getByLabel('Alocat lui').selectOption({ label: `Maria Pop · Șofer` });
  await page.getByRole('button', { name: 'Schimbă șoferul' }).click();
  await expect(page.locator('dd', { hasText: driver })).toBeVisible();
  await shot(page, 'fleet-live-vehicle', name());

  // Archives the Transit, after the confirmation.
  await page.getByRole('button', { name: 'Vehicule' }).filter({ visible: true }).first().click();
  await expect(page.getByText('2 din 2 vehicule')).toBeVisible();
  await page.getByRole('button', { name: new RegExp(plate2) }).click();
  await openVehicleSection(page, 'Șofer și responsabil');
  await page.getByRole('button', { name: 'Mai multe' }).click();
  await page.getByRole('menuitem', { name: 'Arhivează vehiculul' }).click();
  await page.getByRole('button', { name: 'Arhivează', exact: true }).click();
  await expect(page.getByText('Arhivat').first()).toBeVisible();
  await page.getByRole('button', { name: 'Vehicule' }).filter({ visible: true }).first().click();
  await expect(page.getByText('1 din 1 vehicule')).toBeVisible();
  await shot(page, 'fleet-live-vehicles', name());

  // The driver: only the assigned vehicle, no money, no add button.
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
  const other = await context.newPage();
  await signIn(other, driver, PASSWORD);
  await expect(other).toHaveURL(/\/c\/cauta/);
  await other.goto(`/c/firme/${company.id}?sectiune=vehicule`);
  await expect(other.getByText('1 din 1 vehicule')).toBeVisible();
  await expect(other.getByText(plate1)).toBeVisible();
  await expect(other.getByText(plate2)).toHaveCount(0);
  await expect(other.getByRole('button', { name: 'Adaugă vehicul' })).toHaveCount(0);
  await expect(other.getByText('Cost anul acesta')).toHaveCount(0);
  await other.goto(`/c/firme/${company.id}?sectiune=rapoarte`);
  await expect(other.getByText('Rapoartele nu sunt disponibile pentru rolul tău', { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(other);
  await context.close();

  // The language switch of the frame.
  await page.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vehicles' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'fleet-live-en', name());
});

test('the plan: Abonament, the limits of Fleet Start, and the admin changes the plan', async ({ page, browser }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  const admin = await createFleetUser();
  const company = await rpcAs<{ id: string }>(admin, 'create_company', {
    p_name: `Plan Test ${Date.now()}`,
    p_vat_id: null,
    p_reg_com: null,
    p_address: null,
    p_request_id: crypto.randomUUID(),
  });
  await signIn(page, admin, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);

  // A new company: Fleet Business on trial; the badge opens Abonament.
  await page.goto(`/c/firme/${company.id}`);
  await page.getByRole('button', { name: /Fleet Business/ }).filter({ visible: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Abonament și facturare' })).toBeVisible();
  await expect(page.getByText(/Mai ai 30 de zile din perioada de test|Mai ai 29 de zile din perioada de test/)).toBeVisible();
  await expect(page.getByText('Plata cu cardul și schimbarea planului nu sunt încă disponibile.')).toBeVisible();
  await expect(page.getByText('Planul tău')).toBeVisible();
  for (const plan of ['Fleet Start', 'Fleet Pro', 'Enterprise']) await expect(page.getByText(plan, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Aprobarea devizelor după rol')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await shot(page, 'fleet-subscription', name());

  // On Fleet Start: reports locked, no CSV, the sixth vehicle refused.
  await serviceRest(`company_subscriptions?company_id=eq.${company.id}`, 'PATCH', { plan_key: 'fleet_start' });
  for (let i = 0; i < 5; i++) {
    await rpcAs(admin, 'fleet_save_vehicle', {
      p_company: company.id,
      p_vehicle: null,
      p_fields: { make: 'Dacia', model: 'Logan', plate: uniquePlate('B') },
      p_request_id: crypto.randomUUID(),
    });
  }
  await page.goto(`/c/firme/${company.id}?sectiune=rapoarte`);
  await expect(page.getByText('Rapoartele sunt incluse din Fleet Business', { exact: true })).toBeVisible();
  await page.goto(`/c/firme/${company.id}?sectiune=vehicule`);
  await expect(page.getByText('5 din 5 vehicule')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descarcă CSV' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Adaugă vehicul' }).click();
  await page.getByLabel('Marcă').fill('Ford');
  await page.getByLabel('Model', { exact: true }).fill('Transit');
  await page.getByRole('button', { name: 'Salvează vehiculul' }).click();
  await expect(page.getByText('Planul permite 5 vehicule active. Arhivează un vehicul sau alege un plan mai mare.')).toBeVisible();

  // The platform admin moves it to Fleet Pro from Flote.
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
  const adminPage = await context.newPage();
  await signIn(adminPage, SEED.admin, SEED_PASSWORD);
  await adminPage.goto('/admin/cont/flote');
  const row = adminPage.locator('li', { hasText: 'Plan Test' }).filter({ hasText: admin }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Mai multe' }).click();
  await adminPage.getByRole('menuitem', { name: 'Schimbă planul' }).click();
  await row.getByLabel('Plan', { exact: true }).selectOption('fleet_pro');
  await row.getByRole('button', { name: 'Salvează' }).click();
  await expect(row.getByText('5 / 40')).toBeVisible();
  await expectNoHorizontalScroll(adminPage);
  await shot(adminPage, 'admin-fleets', name());
  await context.close();

  // The company sees Fleet Pro (live) and can add the sixth vehicle.
  await page.getByRole('button', { name: 'Salvează vehiculul' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Ford Transit' }).or(page.getByText('Fără număr').first())).toBeVisible();
});

test('bookings: the driver books a company vehicle, the manager approves within the limit', async ({ page, browser }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  const admin = await createFleetUser();
  const manager = await createFleetUser();
  const driver = await createFleetUser();
  const company = await rpcAs<{ id: string }>(admin, 'create_company', {
    p_name: `Programări Test ${Date.now()}`,
    p_vat_id: null,
    p_reg_com: null,
    p_address: null,
    p_request_id: crypto.randomUUID(),
  });
  const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  for (const [email, role] of [
    [manager, 'manager'],
    [driver, 'driver'],
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
  await rpcAs(admin, 'set_company_rules', {
    p_company: company.id,
    p_manager_approval_limit: 500,
    p_budget_monthly: null,
    p_budget_yearly: null,
    p_request_id: crypto.randomUUID(),
  });
  const { email: shop, shopId } = await createBookableShop(`Atelier Flotă ${Date.now()}`, ['ulei']);

  // The driver books from the vehicle page: the vehicle is already picked on the car step.
  await signIn(page, driver, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  await page.goto(`/c/firme/${company.id}?sectiune=vehicul&vehicul=${vehicle.id}`);
  await page.getByRole('button', { name: 'Programează la service' }).click();
  await expect(page).toHaveURL(/\/c\/cauta/);
  await page.goto(`/c/service/${shopId}/programare?pas=2&serviciu=ulei`);
  await page.getByRole('button', { name: /: \d+ loc/ }).first().click();
  await page.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();
  await expect(page.getByRole('button', { name: new RegExp(plate), pressed: true })).toBeVisible();
  await expect(page.getByText('Devizul îl aprobă firma.')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'fleet-book-car-step', name());
  await page.getByRole('button', { name: 'Trimite cererea' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Cerere trimisă' })).toBeVisible();

  // The shop inspects and sends a quote of 600 lei.
  const [booking] = await serviceRest<{ id: string }[]>(`bookings?company_id=eq.${company.id}&select=id`, 'GET');
  await rpcAs(shop, 'confirm_booking', { p_booking_id: booking!.id, p_request_id: crypto.randomUUID() });
  await rpcAs(shop, 'start_inspection', { p_booking_id: booking!.id, p_request_id: crypto.randomUUID() });
  await rpcAs(shop, 'send_quote', {
    p_booking_id: booking!.id,
    p_items: [
      { name: 'Plăcuțe', price: 420 },
      { name: 'Manoperă', price: 180 },
    ],
    p_request_id: crypto.randomUUID(),
  });

  // The driver's Programări: a company car, its quote answered by the company.
  await page.goto('/c/programari');
  await expect(page.getByText('Devizul îl aprobă firma, în spațiul flotei.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
  await shot(page, 'fleet-driver-bookings', name());

  // The manager: over the limit refused; one line within it approved.
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
  const mgr = await context.newPage();
  await signIn(mgr, manager, PASSWORD);
  await expect(mgr).toHaveURL(/\/c\/cauta/);
  await mgr.goto(`/c/firme/${company.id}`);
  await mgr.getByRole('button', { name: 'Programări', exact: true }).filter({ visible: true }).first().click();
  await expect(mgr.getByRole('heading', { level: 1, name: 'Programări' })).toBeVisible();
  await expect(mgr.getByText('Poți aproba până la 500 lei.')).toBeVisible();
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, 'fleet-bookings-quote', name());
  await mgr.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(mgr.getByText('Suma depășește limita ta de aprobare (500 lei). O aprobă un administrator.')).toBeVisible();
  await mgr.getByRole('checkbox', { name: /Manoperă/ }).uncheck();
  await mgr.getByRole('button', { name: 'Accept selectate' }).click();
  await expect(mgr.getByText('Deviz aprobat').first()).toBeVisible();
  await expect(mgr.getByText('Aprobat: 420 lei')).toBeVisible();
  await shot(mgr, 'fleet-bookings-approved', name());

  // Cont: the rarer pages as tiles; the manager has no Membri tile.
  await mgr.getByRole('button', { name: 'Cont', exact: true }).filter({ visible: true }).first().click();
  await expect(mgr.getByRole('link', { name: /Rapoarte/ })).toBeVisible();
  await expect(mgr.getByRole('link', { name: /Membri și roluri/ })).toHaveCount(0);
  await expect(mgr.getByRole('link', { name: /Pagina firmei/ })).toBeVisible();
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, 'fleet-account', name());

  // In English: the five pages and the bookings.
  await mgr.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
  await expect(mgr.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
  await mgr.getByRole('button', { name: 'Bookings', exact: true }).filter({ visible: true }).first().click();
  await expect(mgr.getByText('Approved: 420 RON')).toBeVisible();
  await expectNoHorizontalScroll(mgr);
  await shot(mgr, 'fleet-bookings-en', name());
  await context.close();
});
