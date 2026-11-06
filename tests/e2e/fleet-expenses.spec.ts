import { expect, test, type Page } from '@playwright/test';
import { BACKEND, PASSWORD, createFleetUser, expectNoHorizontalScroll, rpcAs, serviceRest, shot, signIn, uniquePlate } from './support';

// M1 — the company's own expenses: the admin adds one with a receipt photo, the same one again is
// asked about once more, edits and deletes it; the driver adds a fuel receipt for the vehicle assigned
// to them, which arrives „De verificat” and the admin checks it. The database rules (rights, other
// companies, duplicates, the report) are in tests/sql/143_fleet_expenses.sql.

const name = () => test.info().project.name;
// A 1×1 PNG: a receipt photo the bucket accepts.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

async function setup() {
  const admin = await createFleetUser();
  const driver = await createFleetUser();
  const company = await rpcAs<{ id: string }>(admin, 'create_company', {
    p_name: `Cheltuieli ${Date.now()}`,
    p_vat_id: null,
    p_reg_com: null,
    p_address: null,
    p_request_id: crypto.randomUUID(),
  });
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  await rpcAs(admin, 'invite_company_member', { p_company: company.id, p_email: driver, p_role: 'driver', p_token: token, p_request_id: crypto.randomUUID() });
  await rpcAs(driver, 'accept_company_invite', { p_token: token, p_request_id: crypto.randomUUID() });
  const plate = uniquePlate('B');
  const vehicle = await rpcAs<{ id: string }>(admin, 'fleet_save_vehicle', {
    p_company: company.id,
    p_vehicle: null,
    p_fields: { make: 'Dacia', model: 'Logan', plate },
    p_request_id: crypto.randomUUID(),
  });
  const members = await serviceRest<{ id: string }[]>(`company_members?company_id=eq.${company.id}&role=eq.driver&select=id`, 'GET');
  await rpcAs(admin, 'fleet_assign_driver', { p_vehicle: vehicle.id, p_member: members[0]!.id, p_request_id: crypto.randomUUID() });
  return { admin, driver, company: company.id, vehicle: vehicle.id, plate };
}

async function fillExpense(page: Page, amount: string, supplier: string) {
  await page.getByRole('combobox', { name: 'Categorie' }).selectOption('parts');
  await page.getByLabel('Suma').fill(amount);
  await page.getByLabel('Service sau furnizor').fill(supplier);
}

test('the admin adds an expense with a receipt, is asked about a duplicate, edits and deletes it', async ({ page }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  const { admin, company } = await setup();
  await signIn(page, admin, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  await page.goto(`/c/firme/${company}?sectiune=costuri`);

  await page.getByRole('button', { name: 'Adaugă cheltuială' }).click();
  await fillExpense(page, '250', 'Auto Piese SRL');
  await page.getByLabel('Bon sau factură (fotografie sau PDF)').setInputFiles({ name: 'bon.png', mimeType: 'image/png', buffer: PNG });
  await expectNoHorizontalScroll(page);
  await shot(page, 'expense-form', name());
  await page.getByRole('button', { name: 'Salvează cheltuiala' }).click();
  const row = page.locator('li').filter({ hasText: 'Auto Piese SRL' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('250');
  const [saved] = await serviceRest<{ receipt_path: string | null }[]>(`fleet_expenses?company_id=eq.${company}&select=receipt_path`, 'GET');
  expect(saved!.receipt_path).toMatch(new RegExp(`^${company}/`));

  // The same receipt again: asked once more, in the page.
  await page.getByRole('button', { name: 'Adaugă cheltuială' }).click();
  await fillExpense(page, '250', 'Auto Piese SRL');
  await page.getByRole('button', { name: 'Salvează cheltuiala' }).click();
  await expect(page.getByText('Există deja o cheltuială identică pentru acest vehicul.')).toBeVisible();
  await page.getByRole('button', { name: 'Renunță' }).first().click();
  await page.getByRole('button', { name: 'Renunță' }).first().click();
  await expect(page.locator('li').filter({ hasText: 'Auto Piese SRL' })).toHaveCount(1);

  // Edit from „Mai multe”.
  await row.getByRole('button', { name: 'Mai multe' }).click();
  await page.getByRole('menuitem', { name: 'Editează' }).click();
  await page.getByLabel('Suma').fill('260');
  await page.getByRole('button', { name: 'Salvează cheltuiala' }).click();
  await expect(page.locator('li').filter({ hasText: 'Auto Piese SRL' })).toContainText('260');
  await shot(page, 'expense-list', name());

  // Delete, after an inline confirmation.
  const edited = page.locator('li').filter({ hasText: 'Auto Piese SRL' });
  await edited.getByRole('button', { name: 'Mai multe' }).click();
  await page.getByRole('menuitem', { name: 'Șterge' }).click();
  await page.getByRole('button', { name: 'Da, șterge' }).click();
  await expect(page.locator('li').filter({ hasText: 'Auto Piese SRL' })).toHaveCount(0);
});

test('the driver adds a fuel receipt; the admin sees it to check and checks it', async ({ page, browser }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  const { admin, driver, company, vehicle } = await setup();
  await signIn(page, driver, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  await page.goto(`/c/firme/${company}?sectiune=vehicul&vehicul=${vehicle}`);
  await page.getByRole('button', { name: 'Adaugă alimentare' }).click();
  await page.getByLabel('Suma').fill('300');
  await page.getByLabel('Litri').fill('42,5');
  await page.getByRole('combobox', { name: 'Tip combustibil' }).selectOption('diesel');
  await page.getByText('Rezervor plin').click();
  await page.getByLabel('Service sau furnizor').fill('Petrom');
  await page.getByLabel('Bon sau factură (fotografie sau PDF)').setInputFiles({ name: 'bon.png', mimeType: 'image/png', buffer: PNG });
  await expectNoHorizontalScroll(page);
  await shot(page, 'expense-driver-fuel', name());
  await page.getByRole('button', { name: 'Salvează cheltuiala' }).click();
  await expect(page.getByRole('button', { name: 'Adaugă alimentare' })).toHaveAttribute('aria-expanded', 'false');
  const [fuel] = await serviceRest<{ status: string; liters: number; full_tank: boolean }[]>(
    `fleet_expenses?company_id=eq.${company}&select=status,liters,full_tank`,
    'GET',
  );
  expect(fuel).toMatchObject({ status: 'to_check', liters: 42.5, full_tank: true });

  const ctx = await browser.newContext();
  const adminPage = await ctx.newPage();
  await adminPage.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
  await signIn(adminPage, admin, PASSWORD);
  await expect(adminPage).toHaveURL(/\/c\/cauta/);
  await adminPage.goto(`/c/firme/${company}?sectiune=costuri`);
  const row = adminPage.locator('li').filter({ hasText: 'Petrom' });
  await expect(row.getByText('De verificat')).toBeVisible();
  await row.getByRole('button', { name: 'Mai multe' }).click();
  await adminPage.getByRole('menuitem', { name: 'Marchează verificată' }).click();
  await expect(row.getByText('De verificat')).toHaveCount(0);
  await ctx.close();
});
