import { expect, test, type Locator, type Page } from '@playwright/test';
import { BACKEND, PASSWORD, createBookableShop, createUser, rpcAs, shot, signIn } from './support';

// The three animations of 15 Oct (src/lib/motion.ts): the heart of a favorite, the jump of a count
// on the tab bar and the glow of a request that arrives live at the shop. The other tests run with
// less motion; these ask for the animations.

test.use({ contextOptions: { reducedMotion: 'no-preference' } });
test.skip(!BACKEND, 'needs the local Supabase stack');

const name = () => test.info().project.name;
const running = (el: Locator) => el.evaluate((node) => node.getAnimations().length);
const navLink = (page: Page, label: RegExp) => page.getByRole('link', { name: label }).filter({ visible: true }).first();

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
});

async function bookAs(client: string, shopId: string) {
  const av = await rpcAs<{ days: { date: string; bookable: boolean }[] }>(client, 'get_availability', { p_shop_id: shopId, p_days: 30 });
  const day = av.days.find((d) => d.bookable)!.date;
  const slots = await rpcAs<{ slots: { time: string; available: boolean }[] }>(client, 'get_availability', {
    p_shop_id: shopId,
    p_from: day,
    p_days: 1,
    p_slots_for: day,
  });
  return rpcAs<{ ref: string }>(client, 'create_booking', {
    p_shop_id: shopId,
    p_service_id: 'ulei',
    p_date: day,
    p_slot: slots.slots.find((s) => s.available)!.time,
    p_request_id: crypto.randomUUID(),
    p_car: { make: 'Dacia', model: 'Logan', year: 2019, plate: 'BV 12 ANM' },
    p_save_car: false,
    p_note: 'Cerere sosită live',
  });
}

test('a favorite: the heart pops once saved, not when removed', async ({ page }) => {
  const shopName = `Atelier Inimă ${Date.now() % 100000}`;
  await createBookableShop(shopName, ['ulei']);
  const client = await createUser('client');
  await signIn(page, client, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  await page.goto(`/c/cauta?q=${encodeURIComponent(shopName)}`);

  const save = page.getByRole('button', { name: `Salvează ${shopName} la favorite` });
  await save.click();
  const remove = page.getByRole('button', { name: `Scoate ${shopName} din favorite` });
  await expect(remove).toBeVisible();
  expect(await running(remove.locator('svg'))).toBeGreaterThan(0);
  await shot(page, 'motion-favorite', name());
  await remove.click();
  await expect(save).toBeVisible();
  expect(await running(save.locator('svg'))).toBe(0);
});

test('a request arriving live: the count jumps, the number of "Cereri noi" and the card glow', async ({ page }) => {
  const shopName = `Atelier Cerere ${Date.now() % 100000}`;
  const { email: shop, shopId } = await createBookableShop(shopName, ['ulei']);
  const client = await createUser('client');
  await signIn(page, shop, PASSWORD);
  await expect(page).toHaveURL(/\/s\/panou$/);
  // Panou has loaded with no request: a request already there when it loads does not light up.
  await expect(page.getByText('Nicio programare azi.')).toBeVisible();
  await expect(page.getByRole('link', { name: /^\d+ Cereri noi$/ })).toHaveCount(0);
  await expect(page.getByText('Cereri noi')).toBeVisible();

  // Panou: the number of "Cereri noi" lights up when the request comes in (not the whole box).
  await bookAs(client, shopId);
  const requests = page.getByRole('link', { name: /^\d+ Cereri noi$/ });
  await expect(requests).toContainText('1');
  expect(await running(requests.locator('span').first())).toBeGreaterThan(0);
  expect(await running(requests)).toBe(0);
  await expect(navLink(page, /^Programări/)).toHaveAccessibleName(/1 cerere nouă/);
  await shot(page, 'motion-request-panou', name());

  // Programări → Cereri: a second request slides in with its glow; the bubble on the tab jumps.
  await requests.click();
  await expect(page.locator('main ul[aria-label] > li')).toHaveCount(1);
  const second = await bookAs(client, shopId);
  const fresh = page.locator('main ul[aria-label] > li').filter({ hasText: second.ref });
  await expect(fresh).toBeVisible();
  expect(await running(fresh.locator(':scope > *').first())).toBeGreaterThan(0);
  await expect(navLink(page, /^Programări/)).toHaveAccessibleName(/2 cereri noi/);
  await shot(page, 'motion-request-card', name());
});
