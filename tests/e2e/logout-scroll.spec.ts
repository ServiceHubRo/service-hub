import { expect, test } from '@playwright/test';
import { BACKEND, PASSWORD, createUser, scrollTopOf, signIn } from './support';

// Where the public page opens (Eduard, 13 Nov 2026: after signing out the landing page opened in its
// middle, at „Pentru șoferi”). Cause: the rule „a new screen at the top, back where it was left”
// lived in the signed-in shell only; signing out replaced the address with the public page and the
// shell went away with the rule, so the document kept the offset of Cont. It is now the app's
// (App → ScrollMemory, src/lib/scrollMemory.ts).

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

test.describe('where the public pages open', () => {
  test('signing out from the end of Cont opens the public page at its very top', async ({ page }) => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    await signIn(page, await createUser('client'), PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await page.goto('/c/cont');
    await expect(page.getByRole('heading', { level: 1, name: 'Cont' })).toBeVisible();
    // As a person gets there: on a phone or a tablet „Deconectare” is the last thing on Cont; on a
    // computer it is in the sidebar, here with the page scrolled to its end.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.getByRole('button', { name: 'Deconectare', exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Deconectează-mă' }).click();

    await expect(page).toHaveURL((url) => url.pathname === '/' && url.hash === '');
    await expect(page.getByRole('heading', { level: 1, name: /^Programarea la service/ })).toBeInViewport();
    await expect.poll(() => scrollTopOf(page)).toBe(0);
    await expect(page.getByRole('link', { name: 'Intră în cont' }).first()).toBeInViewport();
    // And nothing moves it a moment later (the session ends after the page is there).
    await page.waitForTimeout(800);
    expect(await scrollTopOf(page)).toBe(0);
  });

  test('a public page opened from the middle of another starts at its top; back finds the first where it was', async ({ page }) => {
    await page.goto('/');
    const offer = page.getByRole('link', { name: /^Profită acum/ }).first();
    await offer.scrollIntoViewIfNeeded();
    await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(400);
    const left = await scrollTopOf(page);

    await offer.click();
    await expect(page).toHaveURL(/\/cont-nou/);
    await expect.poll(() => scrollTopOf(page)).toBe(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Cont nou' })).toBeInViewport();

    await page.goBack();
    await expect(page).toHaveURL((url) => url.pathname === '/');
    await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(left - 5);
    await expect(offer).toBeInViewport();
  });
});
