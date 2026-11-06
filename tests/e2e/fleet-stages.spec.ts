import { expect, test, type Browser, type Page } from '@playwright/test';
import { BACKEND, PASSWORD, createFleetUser, expectNoHorizontalScroll, expectNoRomanianText, rpcAs, serviceRest, shot, signIn, uniquePlate, userIdOf } from './support';

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
