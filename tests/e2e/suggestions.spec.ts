import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  SEED,
  SEED_PASSWORD,
  createBookableShop,
  createUser,
  expectAccessible,
  expectNoHorizontalScroll,
  inboxRow,
  openAccount,
  shot,
  signIn,
} from './support';

// Sugestii (T26): a client or a shop writes an idea from Cont and sees it "Primită"; the admin
// finds it in Suport → Solicitări (A3a) with who wrote it, marks it, and the author sees the new state.

test.skip(!BACKEND, 'needs the local Supabase stack');

const name = () => test.info().project.name;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
});

/**
 * The admin, in a browser of their own, finds the suggestion in Suport → Solicitări (A3a: the suggestions
 * are a category of the support requests), opens it and gives it a state.
 */
async function adminMarks(browser: Browser, page: Page, text: string, who: RegExp, mark: string) {
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
  const admin = await context.newPage();
  await signIn(admin, SEED.admin, SEED_PASSWORD);
  await expect(admin).toHaveURL(/\/admin\//);
  // The old address still leads there (A3a).
  await admin.goto('/admin/suport/sugestii');
  await expect(admin).toHaveURL(/\/admin\/suport\/solicitari$/);
  await admin.goto('/admin/suport/solicitari?categorie=suggestions');
  await expect(admin.getByRole('heading', { level: 1, name: 'Solicitări' })).toBeVisible();
  const row = inboxRow(admin, text);
  await expect(row).toContainText('Nouă');
  await expect(row).toContainText(who);
  await expectAccessible(admin, 'admin suggestions');
  await expectNoHorizontalScroll(admin);
  await shot(admin, 'suggestions-admin', name());

  await row.click();
  await expect(admin.getByRole('heading', { level: 1, name: text })).toBeVisible();
  await admin.getByRole('combobox', { name: 'Stare', exact: true }).selectOption({ label: mark });
  await admin.getByRole('button', { name: 'Schimbă starea' }).click();
  // Its own state is no longer offered; the pill says it.
  await expect(admin.getByRole('combobox', { name: 'Stare', exact: true }).locator('option', { hasText: mark })).toHaveCount(0);
  await expect(admin.locator('main').getByText(mark, { exact: true }).first()).toBeVisible();
  await admin.goto('/admin/platforma/jurnal');
  await expect(admin.getByText('Stare solicitare schimbată').first()).toBeVisible();
  await context.close();
}

test('a client sends a suggestion, the admin plans it, the client sees it planned', async ({ page, browser }) => {
  const client = await createUser('client');
  const text = `Filtru după marca mașinii ${Date.now() % 100000}`;
  await signIn(page, client, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  await openAccount(page);
  await page.getByRole('link', { name: /^Sugestii/ }).click();
  await expect(page).toHaveURL(/\/c\/cont\/sugestii$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sugestii' })).toBeVisible();
  await expect(page.getByText('Nu există sugestii trimise.')).toBeVisible();

  const send = page.getByRole('button', { name: 'Trimite sugestia' });
  await expect(send).toBeDisabled();
  const field = page.getByLabel('Sugestia ta');
  await field.fill(text);
  await expect(page.getByText(`${text.length} / 1.000 de caractere`)).toBeVisible();
  await send.click();
  await expect(page.getByRole('status').filter({ hasText: 'Sugestie trimisă.' })).toBeVisible();
  await expect(field).toHaveValue('');
  const mine = page.getByRole('listitem').filter({ hasText: text });
  await expect(mine).toContainText('Primită');
  await expectAccessible(page, 'client suggestions');
  await expectNoHorizontalScroll(page);
  await shot(page, 'suggestions-client', name());

  await adminMarks(browser, page, text, /C-\d{5}/, 'Planificată');

  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: text })).toContainText('Planificată');
});

test('a shop sends one; the admin sees the shop and marks it done', async ({ page, browser }) => {
  const shopName = `Atelier Idee ${Date.now() % 100000}`;
  const { email } = await createBookableShop(shopName, ['ulei']);
  const text = `Export lunar în PDF ${Date.now() % 100000}`;
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/s\/panou$/);
  await page.goto('/s/cont/sugestii');
  await page.getByLabel('Sugestia ta').fill(text);
  await page.getByRole('button', { name: 'Trimite sugestia' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: text })).toContainText('Primită');

  await adminMarks(browser, page, text, new RegExp(shopName), 'Făcută');

  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: text })).toContainText('Făcută');
});
