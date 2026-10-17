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
  openAccount,
  shot,
  signIn,
} from './support';

// Sugestii (T26): a client or a shop writes an idea from Cont and sees it "Primită"; the admin
// finds it in Cont → Sugestii with who wrote it, marks it, and the author sees the new state.

test.skip(!BACKEND, 'needs the local Supabase stack');

const name = () => test.info().project.name;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
});

/** The admin, in a browser of their own, marks the suggestion with this text. */
async function adminMarks(browser: Browser, page: Page, text: string, who: RegExp, mark: string) {
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
  const admin = await context.newPage();
  await signIn(admin, SEED.admin, SEED_PASSWORD);
  await expect(admin).toHaveURL(/\/admin\//);
  await admin.goto('/admin/cont/sugestii');
  await expect(admin.getByRole('heading', { level: 1, name: 'Sugestii' })).toBeVisible();
  const card = admin.getByRole('listitem').filter({ hasText: text });
  await expect(card).toContainText('Nouă');
  await expect(card.getByRole('link', { name: who })).toBeVisible();
  await expectAccessible(admin, 'admin suggestions');
  await expectNoHorizontalScroll(admin);
  await shot(admin, 'suggestions-admin', name());

  await card.getByRole('button', { name: mark, exact: true }).click();
  // Its own state is no longer offered: the button is gone, the pill says it.
  await expect(card.getByRole('button', { name: mark, exact: true })).toHaveCount(0);
  await expect(card).toContainText(mark);
  // The "Noi" filter no longer shows it; the change is in the audit log.
  await admin.getByRole('button', { name: /^Nouă \(\d+\)$/ }).click();
  await expect(admin.getByRole('listitem').filter({ hasText: text })).toHaveCount(0);
  await admin.goto('/admin/cont/jurnal');
  await expect(admin.getByText('Stare sugestie schimbată').first()).toBeVisible();
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
  await expect(page.getByText('Nicio sugestie trimisă.')).toBeVisible();

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

  await adminMarks(browser, page, text, /^Client · C-\d{5}/, 'Planificată');

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

  await adminMarks(browser, page, text, new RegExp(`^Service · ${shopName}$`), 'Făcută');

  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: text })).toContainText('Făcută');
});
