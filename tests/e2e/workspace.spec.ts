import { expect, test, type Page } from '@playwright/test';
import { BACKEND, PASSWORD, createFleetUser, createUser, expectNoHorizontalScroll, rpcAs, shot, signIn, uniquePlate } from './support';

// The workspace switch (T65): one dropdown in the shell — hidden for a client without a company;
// Personal and every company of the client otherwise. Switching keeps the page when the new company
// has it, never shows the previous company's data, and Personal brings the personal pages back.

const name = () => test.info().project.name;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

/** The switch on screen (header on a phone or tablet, sidebar on a laptop). */
function switcher(page: Page) {
  return page.getByRole('button', { name: /Spațiul activ:/ }).filter({ visible: true }).first();
}

async function company(admin: string, title: string, plate: string): Promise<string> {
  const c = await rpcAs<{ id: string }>(admin, 'create_company', { p_name: title, p_vat_id: null, p_reg_com: null, p_address: null, p_request_id: crypto.randomUUID() });
  await rpcAs(admin, 'fleet_save_vehicle', { p_company: c.id, p_vehicle: null, p_fields: { make: 'Dacia', model: 'Logan', plate }, p_request_id: crypto.randomUUID() });
  return c.id;
}

test('a client without a company sees no switch', async ({ page }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  const client = await createUser('client');
  await signIn(page, client, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  await expect(page.getByRole('link', { name: 'Garaj' }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Spațiul activ:/ })).toHaveCount(0);
});

test('two companies: switch from Personal, between companies on the same page, and back', async ({ page }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  const admin = await createFleetUser();
  const stamp = Date.now();
  const plateA = uniquePlate('B');
  const plateB = uniquePlate('CJ');
  const a = await company(admin, `Alfa ${stamp}`, plateA);
  const b = await company(admin, `Beta ${stamp}`, plateB);

  await signIn(page, admin, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  await expect(switcher(page)).toHaveAccessibleName(/Personal/);
  await expectNoHorizontalScroll(page);
  await switcher(page).click();
  await expect(page.getByRole('menuitemradio', { name: /Personal/ })).toHaveAttribute('aria-checked', 'true');
  await shot(page, 'workspace-menu', name());
  await page.getByRole('menuitemradio', { name: new RegExp(`Alfa ${stamp}`) }).click();

  // Alfa: its five pages instead of the personal ones.
  await expect(page).toHaveURL(new RegExp(`/c/firme/${a}`));
  await expect(page.getByRole('heading', { level: 1, name: 'Panou' })).toBeVisible();
  await expect(switcher(page)).toHaveAccessibleName(new RegExp(`Alfa ${stamp}`));
  await expect(page.getByRole('link', { name: 'Garaj' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Vehicule', exact: true }).filter({ visible: true }).first().click();
  await expect(page.getByText(plateA)).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'workspace-company', name());

  // Beta, on the same page; nothing of Alfa is shown.
  await switcher(page).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`Beta ${stamp}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/c/firme/${b}\\?sectiune=vehicule`));
  await expect(page.getByText(plateB)).toBeVisible();
  await expect(page.getByText(plateA)).toHaveCount(0);

  // A refresh keeps the space.
  await page.reload();
  await expect(switcher(page)).toHaveAccessibleName(new RegExp(`Beta ${stamp}`));
  await expect(page.getByText(plateB)).toBeVisible();

  // Back to Personal: the personal pages.
  await switcher(page).click();
  await page.getByRole('menuitemradio', { name: /Personal/ }).click();
  await expect(page).toHaveURL(/\/c\/cauta/);
  await expect(page.getByRole('link', { name: 'Garaj' }).filter({ visible: true }).first()).toBeVisible();
});

test('another company is not reachable by changing the address', async ({ page }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  const owner = await createFleetUser();
  const stranger = await createFleetUser();
  const other = await company(owner, `Străină ${Date.now()}`, uniquePlate('B'));
  await company(stranger, `A mea ${Date.now()}`, uniquePlate('B'));
  await signIn(page, stranger, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  await page.goto(`/c/firme/${other}?sectiune=vehicule`);
  await expect(page.getByText('Firma nu există sau nu ai acces la ea.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Vehicule' })).toHaveCount(0);
});
