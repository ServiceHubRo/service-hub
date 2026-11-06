import { expect, test, type Browser, type Page } from '@playwright/test';
import { BACKEND, PASSWORD, createFleetUser, createUser, expectNoHorizontalScroll, rpcAs, serviceRest, shot, signIn, uniquePlate } from './support';

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

/** The menu's spaces, as listed (names only). */
async function spaces(page: Page): Promise<string[]> {
  await switcher(page).click();
  const names = await page.getByRole('menuitemradio').allInnerTexts();
  await page.keyboard.press('Escape');
  return names.map((n) => n.split('\n')[0]!.trim());
}

async function invite(admin: string, companyId: string, email: string, role: string) {
  const tk = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  await rpcAs(admin, 'invite_company_member', { p_company: companyId, p_email: email, p_role: role, p_token: tk, p_request_id: crypto.randomUUID() });
  await rpcAs(email, 'accept_company_invite', { p_token: tk, p_request_id: crypto.randomUUID() });
}

async function freshPage(browser: Browser) {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
  return { context, page: await context.newPage() };
}

test('the switch sits right of the logo, the language is in Cont, and both stay after signing in again', async ({ page, browser }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  const admin = await createFleetUser();
  const id = await company(admin, `Unica ${Date.now()}`, uniquePlate('B'));
  await signIn(page, admin, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);

  // Phone and tablet (Eduard, 6 Nov 2026): one header row, the logo left, the switch right, no language.
  if (test.info().project.name !== 'desktop-1440') {
    const header = page.getByRole('banner');
    // Once the switch has come in (the row settles around it): centered on the logo's line.
    await expect
      .poll(async () => {
        const box = (await switcher(page).boundingBox())!;
        const mark = (await header.getByRole('img', { name: 'Service-Hub' }).boundingBox())!;
        return Math.abs(box.y + box.height / 2 - (mark.y + mark.height / 2));
      })
      .toBeLessThan(4);
    const logo = await header.getByRole('img', { name: 'Service-Hub' }).boundingBox();
    const sw = await switcher(page).boundingBox();
    const viewport = page.viewportSize()!;
    expect(sw!.x).toBeGreaterThan(logo!.x + logo!.width);
    expect(viewport.width - (sw!.x + sw!.width)).toBeLessThan(24);
    await expect(header.getByRole('combobox', { name: /^(Limba|Language)$/ })).toHaveCount(0);
    // The menu opens whole inside the screen, from the right.
    await switcher(page).click();
    const menu = await page.getByRole('menu').boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(viewport.width);
    await shot(page, 'workspace-header', name());
    await page.keyboard.press('Escape');
  }

  // The language: Cont → Preferințe, kept on the profile, the same in the company's space.
  await page.goto('/c/cont');
  await page.getByRole('combobox', { name: 'Limba' }).selectOption('en');
  await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
  await page.goto(`/c/firme/${id}?sectiune=vehicule`);
  await expect(page.getByRole('heading', { level: 1, name: 'Vehicles' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Vehicles' })).toBeVisible();
  const again = await freshPage(browser);
  await signIn(again.page, admin, PASSWORD);
  await expect(again.page.getByRole('link', { name: 'Search' }).filter({ visible: true }).first()).toBeVisible();
  await again.context.close();
  await page.goto('/c/cont');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('ro');
  await expect(page.getByRole('heading', { level: 1, name: 'Cont' })).toBeVisible();

  // Every page, personal or the company's.
  for (const path of ['/c/garaj', '/c/programari', '/c/mesaje', '/c/cont', `/c/firme/${id}?sectiune=vehicule`, `/c/firme/${id}?sectiune=cont`]) {
    await page.goto(path);
    await expect(switcher(page)).toBeVisible();
  }
  expect(await spaces(page)).toEqual(['Personal', expect.stringMatching(/^Unica /)]);

  // Signed in again elsewhere: the same switch.
  const other = await freshPage(browser);
  await signIn(other.page, admin, PASSWORD);
  await expect(other.page).toHaveURL(/\/c\/cauta/);
  await expect(switcher(other.page)).toBeVisible();
  await other.context.close();
});

test('a member sees only the companies they belong to; removed, the company is gone and refused', async ({ page, browser }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  const owner = await createFleetUser();
  const member = await createFleetUser();
  const stamp = Date.now();
  const a = await company(owner, `Alfa ${stamp}`, uniquePlate('B'));
  const plateB = uniquePlate('B');
  await company(owner, `Beta ${stamp}`, plateB);
  const c = await company(owner, `Gama ${stamp}`, uniquePlate('B'));

  // The owner: Personal and the three.
  const own = await freshPage(browser);
  await signIn(own.page, owner, PASSWORD);
  await expect(own.page).toHaveURL(/\/c\/cauta/);
  expect(await spaces(own.page)).toEqual(['Personal', `Alfa ${stamp}`, `Beta ${stamp}`, `Gama ${stamp}`]);
  await own.context.close();

  // Invited into Alfa: Alfa only.
  await invite(owner, a, member, 'driver');
  await signIn(page, member, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  expect(await spaces(page)).toEqual(['Personal', `Alfa ${stamp}`]);

  // Into Gama too: exactly those two, never Beta.
  await invite(owner, c, member, 'accountant');
  await page.reload();
  expect(await spaces(page)).toEqual(['Personal', `Alfa ${stamp}`, `Gama ${stamp}`]);
  await page.goto(`/c/firme/${c}?sectiune=vehicule`);
  await expect(page.getByText(plateB)).toHaveCount(0);

  // Removed from Alfa while its page is open: the page empties and Alfa leaves the switch.
  await page.goto(`/c/firme/${a}?sectiune=panou`);
  await expect(page.getByRole('heading', { level: 1, name: 'Panou' })).toBeVisible();
  const members = await serviceRest<{ id: string }[]>(`company_members?company_id=eq.${a}&role=eq.driver&select=id`, 'GET');
  await rpcAs(owner, 'remove_company_member', { p_member: members[0]!.id, p_request_id: crypto.randomUUID() });
  await expect(page.getByText('Firma nu există sau nu ai acces la ea.')).toBeVisible({ timeout: 15_000 });
  expect(await spaces(page)).toEqual(['Personal', `Gama ${stamp}`]);
  // And by its address, after a reload.
  await page.reload();
  await expect(page.getByText('Firma nu există sau nu ai acces la ea.')).toBeVisible();
  await expectNoHorizontalScroll(page);
});
