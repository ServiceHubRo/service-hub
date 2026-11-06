import { test } from '@playwright/test';
import { PASSWORD, createFleetUser, rpcAs, signIn } from './support';

test('probe print media', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
  const admin = await createFleetUser();
  const c = await rpcAs<{ id: string }>(admin, 'create_company', { p_name: `Print ${Date.now()}`, p_vat_id: null, p_reg_com: null, p_address: null, p_request_id: crypto.randomUUID() });
  await signIn(page, admin, PASSWORD);
  await page.waitForTimeout(1500);
  await page.goto(`/c/firme/${c.id}?sectiune=abonament`);
  await page.waitForTimeout(2500);
  const top = () => page.locator('main').evaluate((el) => Math.round(el.scrollTop));
  for (let i = 0; i < 3; i++) {
    await page.locator('main').evaluate((el, y) => el.scrollTo(0, y), 600 + i * 400);
    await page.waitForTimeout(300);
    const before = await top();
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(200);
    await page.emulateMedia({ media: 'screen' });
    await page.waitForTimeout(800);
    console.warn('PROBE print→screen', before, '→', await top());
  }
});
