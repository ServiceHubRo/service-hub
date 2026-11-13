import { expect, test, type Page } from '@playwright/test';
import { BACKEND, PASSWORD, createUser, scrollTopOf, signIn } from './support';

// Where a page opens (Eduard, 13 Nov 2026): a reload, from the middle or the end of a page, opens it
// at the top, on the public pages and in the app; signing out from the middle of a page opens the
// public page at the top. Moving between screens, „‹ Înapoi”, Back and Forward keep their places.
// Measured cause: on the public pages the browser restored the place itself (scrollRestoration
// 'auto'); the app already opened at the top after a reload (src/lib/scrollMemory.ts, 'manual').

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

async function scrollToShare(page: Page, share: number) {
  await page.evaluate((s) => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - innerHeight) * s)), share);
  await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(200);
  await page.waitForTimeout(300);
}

/** Reloads and checks the page is at the top, and stays there once loaded. */
async function reloadExpectTop(page: Page, heading: RegExp | string) {
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: heading }).first()).toBeInViewport();
  expect(await scrollTopOf(page)).toBe(0);
  await page.waitForTimeout(1200);
  expect(await scrollTopOf(page)).toBe(0);
}

test('a reload from the middle or the end of the public page opens it at the top', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /^Programarea la service/ })).toBeVisible();
  await scrollToShare(page, 0.5);
  await reloadExpectTop(page, /^Programarea la service/);
  await expect(page.getByRole('link', { name: 'Intră în cont' }).first()).toBeInViewport();
  await scrollToShare(page, 1);
  await reloadExpectTop(page, /^Programarea la service/);
});

test('the browser’s Back and Forward on the public pages keep their places', async ({ page }) => {
  await page.goto('/');
  const offer = page.getByRole('link', { name: /^Profită acum/ }).first();
  await offer.scrollIntoViewIfNeeded();
  await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(400);
  await offer.click();
  await expect(page).toHaveURL(/\/cont-nou/);
  await page.goBack();
  await expect(page).toHaveURL((url) => url.pathname === '/');
  // Where it was left (the browser's own restoring), not the top.
  await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(400);
  await page.goForward();
  await expect(page).toHaveURL(/\/cont-nou/);
});

test.describe('in the app', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('a reload from the middle or the end of a page opens it at the top', async ({ page }) => {
    await signIn(page, await createUser('client'), PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await page.goto('/c/cont');
    await expect(page.getByRole('heading', { level: 1, name: 'Cont' })).toBeVisible();
    await scrollToShare(page, 0.5);
    await reloadExpectTop(page, 'Cont');
    await scrollToShare(page, 1);
    await reloadExpectTop(page, 'Cont');
  });

  test('moving between screens, „‹ Înapoi”, Back and Forward keep their places', async ({ page }) => {
    await signIn(page, await createUser('client'), PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    // Inside the app, as a person moves: the bottom bar or the sidebar.
    await page.getByRole('link', { name: 'Cont', exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cont' })).toBeVisible();
    await scrollToShare(page, 0.5);

    // A new screen starts at the top.
    await page.locator('main').getByRole('link', { name: /^Notificări/ }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Notificări' })).toBeVisible();
    expect(await scrollTopOf(page)).toBe(0);
    // Back finds Cont where it was left, Forward the new screen at its top.
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Cont' })).toBeVisible();
    await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(200);
    await page.goForward();
    await expect(page.getByRole('heading', { level: 1, name: 'Notificări' })).toBeVisible();
    await expect.poll(() => scrollTopOf(page)).toBe(0);
    // „‹ Cont” as well.
    await page.locator('main').getByRole('link', { name: /^Cont$/ }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cont' })).toBeVisible();
    await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(200);
  });

  test('signing out from the middle of a page opens the public page at the top', async ({ page }) => {
    await signIn(page, await createUser('client'), PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await page.goto('/c/cont');
    await expect(page.getByRole('heading', { level: 1, name: 'Cont' })).toBeVisible();
    await scrollToShare(page, 0.5);
    await page.getByRole('button', { name: 'Deconectare', exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Deconectează-mă' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/' && url.hash === '');
    await expect(page.getByRole('heading', { level: 1, name: /^Programarea la service/ })).toBeInViewport();
    expect(await scrollTopOf(page)).toBe(0);
    await page.waitForTimeout(800);
    expect(await scrollTopOf(page)).toBe(0);
  });
});
