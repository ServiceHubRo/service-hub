import { expect, test, type Browser } from '@playwright/test';
import { BACKEND, PASSWORD, createFleetUser, expectNoHorizontalScroll, openAccount, shot, signIn } from './support';

// Companies (T63b): a client creates a company from Cont, invites a colleague as driver by link,
// the colleague accepts with their own account and sees only what a driver sees; the admin hands the
// administration over. The personal space stays as it was. The accounts are fleet test accounts
// (T63c), so the run needs no global switch.

const name = () => test.info().project.name;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

async function asOther(browser: Browser, email: string) {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
  const page = await context.newPage();
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  return { context, page };
}

test('create a company, invite a driver, hand over the administration', async ({ page, browser }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  const admin = await createFleetUser();
  const driver = await createFleetUser();

  await signIn(page, admin, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  await openAccount(page);
  await page.getByRole('link', { name: /Firmele mele/ }).click();
  await expect(page.getByText('Nicio firmă', { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'companies-empty', name());

  // A wrong CUI is caught before sending; then the company is created.
  await page.getByRole('button', { name: 'Creează o firmă' }).click();
  await page.getByLabel('Numele firmei').fill('Transport Test SRL');
  await page.getByLabel(/^CUI/).fill('123');
  await page.getByRole('button', { name: 'Creează firma' }).click();
  await expect(page.getByText('CUI-ul nu este valid.')).toBeVisible();
  await page.getByLabel(/^CUI/).fill('');
  await page.getByLabel(/^Adresa/).fill('Brașov');
  await page.getByRole('button', { name: 'Creează firma' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Transport Test SRL' })).toBeVisible();
  await expect(page.getByText('Administrator').first()).toBeVisible();

  // Rules: a monthly budget.
  await page.getByLabel('Bugetul lunii').fill('4.000');
  await page.getByRole('button', { name: 'Salvează' }).click();
  await expect(page.getByLabel('Bugetul lunii')).toHaveValue('4.000');

  // Invite the driver: the link appears to copy.
  await page.getByLabel('Adresa de email').fill(driver);
  await page.getByLabel('Rolul').selectOption('driver');
  await page.getByRole('button', { name: 'Creează invitația' }).click();
  const linkField = page.locator('#company-invite-link');
  await expect(linkField).toHaveValue(/\/c\/firme\/invitatie\/[0-9a-f]{64}$/);
  const url = new URL(await linkField.inputValue());
  await expect(page.locator('li', { hasText: driver })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'company-admin', name());

  // The driver opens the link with their own account and accepts.
  const other = await asOther(browser, driver);
  await other.page.goto(url.pathname);
  await expect(other.page.getByRole('heading', { name: 'Transport Test SRL' })).toBeVisible();
  await expect(other.page.getByText('Șofer')).toBeVisible();
  await shot(other.page, 'company-invite', name());
  await other.page.getByRole('button', { name: 'Acceptă invitația' }).click();
  await expect(other.page.getByRole('heading', { level: 1, name: 'Transport Test SRL' })).toBeVisible();
  // A driver: no invitation form, no rules, only their own row in the team.
  await expect(other.page.getByRole('button', { name: 'Creează invitația' })).toHaveCount(0);
  await expect(other.page.getByRole('heading', { name: 'Reguli și bugete' })).toHaveCount(0);
  await expect(other.page.locator('li', { hasText: '(tu)' })).toHaveCount(1);
  await expect(other.page.getByText(admin)).toHaveCount(0);
  // The same link does not work twice.
  await other.page.goto(url.pathname);
  await expect(other.page.getByText('Linkul nu mai este valabil', { exact: true })).toBeVisible();
  // The personal garage is untouched.
  await other.page.goto('/c/garaj');
  await expect(other.page).toHaveURL(/\/c\/garaj/);

  // The admin hands the administration to the driver and becomes fleet manager.
  await page.reload();
  const row = page.locator('li', { hasText: driver });
  await expect(row).toBeVisible();
  // The member's actions sit behind "Mai multe" (T63e).
  await row.getByRole('button', { name: 'Mai multe' }).click();
  await page.getByRole('menuitem', { name: 'Predă administrarea' }).click();
  await row.getByRole('button', { name: 'Predă administrarea' }).click();
  await expect(page.getByRole('heading', { name: 'Reguli și bugete' })).toHaveCount(0);
  await expect(page.getByText('Manager de flotă').first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await other.context.close();
});

test('the companies screen in English', async ({ page }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  const email = await createFleetUser();
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  await page.goto('/c/cont/firme');
  await page.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
  await expect(page.getByText('No companies', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create a company' }).click();
  await expect(page.getByLabel('Company name')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'companies-en', name());
});
