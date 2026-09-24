import { expect, test } from '@playwright/test';
import { PUBLISHED_PORT } from './ports';

// The published site (not a deploy preview): real accounts only — the T01 role switch is gone —
// and developer-only pages stay hidden.
test.use({ baseURL: `http://localhost:${PUBLISHED_PORT}` });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
});

test('published site: the landing page leads to sign-in and sign-up, no test links', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Componente' })).toHaveCount(0);
  await expect(page.getByText('Rol de test')).toHaveCount(0);
  await page.getByRole('link', { name: 'Creează cont' }).click();
  await expect(page).toHaveURL(/\/cont-nou$/);
  await expect(page.getByRole('button', { name: 'Sunt client' })).toBeVisible();
  await page.screenshot({ path: `test-results/shots/published-signup-${test.info().project.name}.png` });
});

test('published site: ?rol= no longer opens anything', async ({ page }) => {
  await page.goto('/?rol=client');
  await expect(page.getByRole('link', { name: 'Intră în cont' })).toBeVisible();
  await page.goto('/c/cauta?rol=client');
  await expect(page).toHaveURL(/\/intra$/);
});

test('published site: the component gallery is not reachable', async ({ page }) => {
  await page.goto('/dev/componente');
  await expect(page).toHaveURL(/\/$/);
});
