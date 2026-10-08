import { expect, test } from '@playwright/test';
import { BACKEND, PASSWORD, createBookableShop, createUser, expectNoHorizontalScroll, serviceRest, shot, signIn } from './support';

// Launch price per city (Eduard, 8 Oct): a shop that signed up at the launch price is a founding
// partner — the badge on its search card and its page, without changing the order of the list.

const name = () => test.info().project.name;
const tag = () => `${Date.now() % 100000}${Math.floor(Math.random() * 100)}`;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

test.describe('founding partners', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(90_000);

  test('the badge on the search card and the shop page, only for shops at the launch price', async ({ page }) => {
    const founderName = `Atelier Fondator ${tag()}`;
    const otherName = `Atelier Standard ${tag()}`;
    const { shopId: founder } = await createBookableShop(founderName, ['ulei']);
    const { shopId: other } = await createBookableShop(otherName, ['ulei']);
    // The second one as if it signed up after its city's places were taken.
    await serviceRest(`subscriptions?shop_id=eq.${other}`, 'PATCH', { launch_offer: false, price_ron: 149 });
    const [row] = await serviceRest<{ founder: boolean }[]>(`shops?id=eq.${founder}&select=founder`, 'GET');
    expect(row!.founder).toBe(true);

    const client = await createUser('client');
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await page.goto(`/c/cauta?q=${encodeURIComponent('Atelier')}`);
    const founderCard = page.locator('main li').filter({ hasText: founderName });
    const otherCard = page.locator('main li').filter({ hasText: otherName });
    await expect(founderCard.getByText('Partener fondator')).toBeVisible();
    await expect(otherCard).toBeVisible();
    await expect(otherCard.getByText('Partener fondator')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await founderCard.scrollIntoViewIfNeeded();
    await shot(page, 'founder-card', name());

    await page.goto(`/c/service/${founder}`);
    await expect(page.getByRole('heading', { level: 1, name: founderName })).toBeVisible();
    await expect(page.getByText('Partener fondator')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 'founder-page', name());
    await page.goto(`/c/service/${other}`);
    await expect(page.getByRole('heading', { level: 1, name: otherName })).toBeVisible();
    await expect(page.getByText('Partener fondator')).toHaveCount(0);
  });
});
