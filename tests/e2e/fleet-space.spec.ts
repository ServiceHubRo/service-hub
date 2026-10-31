import { expect, test } from '@playwright/test';
import { BACKEND, PASSWORD, createFleetUser, expectNoHorizontalScroll, rpcAs, shot, signIn, uniquePlate } from './support';

// The company's fleet space (T63c): the admin opens the fleet from the company page, adds a vehicle
// with the form (a plate already in the fleet is refused), assigns it to the driver, archives
// another; the driver opens the same fleet and sees only the vehicle assigned to them, without
// money or the add button. Its own frame: top bar with the language, the five fleet pages.

const name = () => test.info().project.name;

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
  await page.getByRole('button', { name: /Șofer și responsabil/ }).click();
  await page.getByLabel('Alocat lui').selectOption({ label: `Maria Pop · Șofer` });
  await page.getByRole('button', { name: 'Schimbă șoferul' }).click();
  await expect(page.locator('dd', { hasText: driver })).toBeVisible();
  await shot(page, 'fleet-live-vehicle', name());

  // Archives the Transit, after the confirmation.
  await page.getByRole('button', { name: 'Vehicule' }).filter({ visible: true }).first().click();
  await expect(page.getByText('2 din 2 vehicule')).toBeVisible();
  await page.getByRole('button', { name: new RegExp(plate2) }).click();
  await page.getByRole('button', { name: /Șofer și responsabil/ }).click();
  await page.getByRole('button', { name: 'Arhivează vehiculul' }).click();
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
