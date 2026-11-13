import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createAgent, signInAgent } from './agent';
import { BACKEND, PASSWORD, SEED, SEED_PASSWORD, createFleetUser, createUser, rpcAs, scrollTopOf, serviceRest, signIn, userIdOf } from './support';

// After signing out, the public page at its very top (Eduard, 13 Nov 2026: it opened at „Pentru
// șoferi”). Cause: the address is replaced with `/` (no hash, no query, no other redirect) while the
// page is still scrolled where „Deconectare” was — the end of Cont on a phone or a tablet — and the
// public page sets no place of its own, so it kept that offset. Fix: src/lib/afterSignOut.ts. The
// reload: tests/e2e/scroll-reload.spec.ts.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

/** From the end of the page, as a person gets to „Deconectare”: Cont on a phone or a tablet, the sidebar on a computer. */
async function signOutFromTheEnd(page: Page, start: string, account: string) {
  const logout = page.getByRole('button', { name: 'Deconectare', exact: true }).filter({ visible: true });
  for (const path of [start, account]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    // A page that fits the screen proves nothing here: Cont is longer than the screen everywhere.
    if ((await logout.count()) > 0 && (await scrollTopOf(page)) > 0) break;
  }
  expect(await scrollTopOf(page), 'the page is scrolled before signing out').toBeGreaterThan(0);
  await logout.first().click();
  await page.getByRole('button', { name: 'Deconectează-mă' }).click();
}

async function expectPublicPageAtTop(page: Page) {
  await expect(page).toHaveURL((url) => url.pathname === '/' && url.search === '' && url.hash === '');
  await expect(page.getByRole('heading', { level: 1, name: /^Programarea la service/ })).toBeInViewport();
  await expect(page.getByRole('link', { name: 'Intră în cont' }).first()).toBeInViewport();
  expect(await scrollTopOf(page)).toBe(0);
  // And nothing moves it a moment later (the session ends after the page is drawn).
  await page.waitForTimeout(800);
  expect(await scrollTopOf(page)).toBe(0);
}

test.describe('signing out opens the public page at its top', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test('client', async ({ page }) => {
    await signIn(page, await createUser('client'), PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await signOutFromTheEnd(page, '/c/cont', '/c/cont');
    await expectPublicPageAtTop(page);
  });

  test('company member, from the company space', async ({ page }) => {
    const admin = await createFleetUser();
    const company = await rpcAs<{ id: string }>(admin, 'create_company', {
      p_name: `Logout ${Date.now()}`,
      p_vat_id: null,
      p_reg_com: null,
      p_address: null,
      p_request_id: randomUUID(),
    });
    await signIn(page, admin, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await signOutFromTheEnd(page, `/c/firme/${company.id}?sectiune=abonament`, '/c/cont');
    await expectPublicPageAtTop(page);
  });

  test('shop owner', async ({ page }) => {
    await signIn(page, await createUser('shop'), PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou/);
    await signOutFromTheEnd(page, '/s/cont', '/s/cont');
    await expectPublicPageAtTop(page);
  });

  test('shop colleague', async ({ page }) => {
    const owner = await createUser('shop');
    const [shop] = await serviceRest<{ id: string }[]>(`shops?owner_id=eq.${await userIdOf(owner)}&select=id`, 'GET');
    const colleague = await createUser('client', { name: 'Coleg Deconectare' });
    const colleagueId = await userIdOf(colleague);
    await serviceRest(`profiles?id=eq.${colleagueId}`, 'PATCH', { role: 'shop' });
    await serviceRest('shop_staff', 'POST', { shop_id: shop!.id, user_id: colleagueId, invited_email: colleague, role: 'staff', accepted_at: new Date().toISOString() });
    await signIn(page, colleague, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou/);
    await signOutFromTheEnd(page, '/s/cont', '/s/cont');
    await expectPublicPageAtTop(page);
  });

  test('support agent', async ({ page }) => {
    await signInAgent(page, await createAgent());
    await expect(page).toHaveURL(/\/suport\//);
    await signOutFromTheEnd(page, '/suport/cont', '/suport/cont');
    await expectPublicPageAtTop(page);
  });

  test('platform admin', async ({ page }) => {
    await signIn(page, SEED.admin, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/admin\//, { timeout: 30_000 });
    await signOutFromTheEnd(page, '/admin/cont', '/admin/cont');
    await expectPublicPageAtTop(page);
  });
});
