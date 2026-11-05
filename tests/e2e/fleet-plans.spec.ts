import { expect, test, type Page } from '@playwright/test';
import { BACKEND, PASSWORD, createFleetUser, expectNoHorizontalScroll, rpcAs, serviceRest, shot, signIn, uniquePlate } from './support';

// Three real plans (T65): Fleet Start shows the essentials and says, discreetly, where the rest is;
// Business adds the financial dashboard, the reports and CSV; Pro adds the trend per vehicle,
// filters, a chosen range, the forecast and Excel. The database answers each plan the same way
// (tests/sql/139_fleet_plan_features.sql); here the screens are checked.

const name = () => test.info().project.name;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

async function setPlan(company: string, plan: string) {
  await serviceRest(`company_subscriptions?company_id=eq.${company}`, 'PATCH', { plan_key: plan });
}

async function openSection(page: Page, company: string, section: string) {
  await page.goto(`/c/firme/${company}?sectiune=${section}`);
}

test('Start, Business and Pro: the same identity, different tools', async ({ page }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  const admin = await createFleetUser();
  const company = await rpcAs<{ id: string }>(admin, 'create_company', {
    p_name: `Planuri ${Date.now()}`,
    p_vat_id: null,
    p_reg_com: null,
    p_address: null,
    p_request_id: crypto.randomUUID(),
  });
  await rpcAs(admin, 'fleet_save_vehicle', {
    p_company: company.id,
    p_vehicle: null,
    p_fields: { make: 'Dacia', model: 'Logan', plate: uniquePlate('B'), itp_expiry: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10) },
    p_request_id: crypto.randomUUID(),
  });
  await signIn(page, admin, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);

  // Fleet Start: the essentials, the deadlines, the rest named with its plan.
  await setPlan(company.id, 'fleet_start');
  await openSection(page, company.id, 'panou');
  await expect(page.getByRole('heading', { name: 'Termene apropiate' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Panoul financiar' })).toBeVisible();
  await expect(page.getByText('Disponibil în Fleet Business').first()).toBeVisible();
  await expect(page.getByText('Cheltuieli anul acesta')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await shot(page, 'plan-start-dashboard', name());
  await openSection(page, company.id, 'rapoarte');
  await expect(page.getByRole('heading', { name: 'Rapoartele de costuri' })).toBeVisible();
  await page.goto(`/c/cont/firme/${company.id}`);
  await expect(page.getByRole('heading', { name: /Reguli și bugete/ })).toBeVisible();
  await expect(page.getByLabel('Bugetul lunii')).toHaveCount(0);

  // Fleet Business: the financial dashboard and the reports; Pro's tools named.
  await setPlan(company.id, 'fleet_business');
  await openSection(page, company.id, 'panou');
  await expect(page.getByText('Cheltuieli anul acesta')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Panoul financiar' })).toHaveCount(0);
  await openSection(page, company.id, 'rapoarte');
  await expect(page.getByLabel('Alege raportul')).toBeVisible();
  await expect(page.getByLabel('Alege raportul').locator('option', { hasText: 'Evoluție pe vehicul · Disponibil în Fleet Pro' })).toHaveCount(1);
  await expect(page.locator('p', { hasText: 'Filtre după departament' }).getByText('Disponibil în Fleet Pro')).toBeVisible();
  await page.getByRole('button', { name: 'Mai multe' }).filter({ visible: true }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Descarcă CSV' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Descarcă Excel' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expectNoHorizontalScroll(page);
  await shot(page, 'plan-business-reports', name());
  await page.goto(`/c/cont/firme/${company.id}`);
  await expect(page.getByLabel('Bugetul lunii')).toBeVisible();

  // Fleet Pro: the trend, the chosen range, filters and Excel.
  await setPlan(company.id, 'fleet_pro');
  await openSection(page, company.id, 'rapoarte');
  await page.getByLabel('Alege raportul').selectOption('trend');
  await expect(page.getByLabel('Perioada').locator('option', { hasText: 'Interval ales' })).toHaveCount(1);
  await page.getByLabel('Perioada').selectOption('custom');
  await expect(page.getByLabel('De la')).toBeVisible();
  await expect(page.getByRole('button', { name: /Filtre/ }).filter({ visible: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Mai multe' }).filter({ visible: true }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Descarcă Excel' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expectNoHorizontalScroll(page);
  await shot(page, 'plan-pro-reports', name());

  // Abonament: the plan's features ticked, a higher plan's additions in amber.
  await setPlan(company.id, 'fleet_business');
  await openSection(page, company.id, 'abonament');
  await expect(page.getByText('Plus: ce adaugă planul față de al tău.')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'plan-subscription', name());
});
