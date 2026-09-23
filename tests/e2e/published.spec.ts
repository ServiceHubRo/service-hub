import { expect, test } from '@playwright/test';
import { PUBLISHED_PORT } from './ports';

// The published site (not a deploy preview): until T04 the role switch works here too,
// so the interfaces can be tried on a phone. Developer-only pages stay hidden.
test.use({ baseURL: `http://localhost:${PUBLISHED_PORT}` });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
});

test('published site: role links on the landing page open each interface', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Rol de test')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Componente' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Service', exact: true }).click();
  await expect(page).toHaveURL(/\/s\//);
  for (const label of ['Panou', 'Programări', 'Istoric', 'Mesaje', 'Cont']) {
    await expect(page.getByRole('link', { name: label, exact: true }).filter({ visible: true })).toHaveCount(1);
  }
  await expect(page.getByRole('link', { name: 'Garaj' })).toHaveCount(0);
  await page.screenshot({ path: `test-results/shots/published-shop-${test.info().project.name}.png` });
});

test('published site: ?rol= switches role', async ({ page }) => {
  await page.goto('/?rol=client');
  await expect(page).toHaveURL(/\/c\//);
  await page.goto('/?rol=admin');
  await expect(page).toHaveURL(/\/admin\//);
});

test('published site: the component gallery is not reachable', async ({ page }) => {
  await page.goto('/dev/componente');
  await expect(page).toHaveURL(/\/$/);
});
