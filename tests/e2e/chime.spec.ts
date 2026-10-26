import { expect, test, type Page } from '@playwright/test';
import { BACKEND, PASSWORD, createBookableShop, createUser, expectNoHorizontalScroll, rpcAs, shot, signIn } from './support';

// T47: the new-booking chime. The shop hears it in the open app when a client's request arrives;
// it is turned off (and tried with "Ascultă") per device in Setări → Notificări. Every chime played
// is counted by wrapping the browser's sound source.

test.skip(!BACKEND, 'needs the local Supabase stack');

const name = () => test.info().project.name;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('sh_lang', 'ro');
    const w = window as Window & { __chimes?: number };
    w.__chimes = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      w.__chimes = (w.__chimes ?? 0) + 1;
      return start.apply(this, args);
    };
  });
});

const chimes = (page: Page) => page.evaluate(() => (window as Window & { __chimes?: number }).__chimes ?? 0);

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
    p_car: { make: 'Dacia', model: 'Logan', year: 2019, plate: 'BV 47 SNT' },
    p_save_car: false,
    p_note: 'Cerere cu sunet',
  });
}

test('a request arriving live rings once; turned off on this device, the next one is quiet', async ({ page }) => {
  const shopName = `Atelier Sunet ${Date.now() % 100000}`;
  const { email: shop, shopId } = await createBookableShop(shopName, ['ulei']);
  const client = await createUser('client');
  await signIn(page, shop, PASSWORD);
  await expect(page).toHaveURL(/\/s\/panou$/);
  await expect(page.getByText('Cereri noi')).toBeVisible();
  // A browser plays sound only after the page was touched once.
  await page.keyboard.press('Shift');
  expect(await chimes(page)).toBe(0);

  await bookAs(client, shopId);
  await expect(page.getByRole('link', { name: /^1 Cereri noi$/ })).toBeVisible();
  await expect.poll(() => chimes(page)).toBe(1);

  // Setări → Notificări: the sound on this device, "Ascultă" plays it.
  await page.goto('/s/cont/setari/notificari');
  const sound = page.getByRole('switch', { name: /Sunet la programare nouă/ });
  await expect(sound).toBeChecked();
  await expect(page.getByText('Pe acest dispozitiv, cât Service-Hub este deschis.')).toBeVisible();
  await page.getByRole('button', { name: 'Ascultă' }).click();
  await expect.poll(() => chimes(page)).toBe(2);
  await expect(page.getByText('Sunetul nu poate fi redat pe acest dispozitiv.')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await shot(page, 't47-sound-setting', name());

  // Also in Cont, under push: both are set on this device.
  await page.goto('/s/cont');
  await expect(page.getByRole('switch', { name: /Sunet la programare nouă/ })).toBeChecked();
  await page.goto('/s/cont/setari/notificari');

  // Off: saved on this device, and the next request is quiet.
  await sound.click();
  await expect(sound).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole('switch', { name: /Sunet la programare nouă/ })).not.toBeChecked();
  await page.goto('/s/panou');
  await page.keyboard.press('Shift');
  const before = await chimes(page);
  await bookAs(client, shopId);
  await expect(page.getByRole('link', { name: /^2 Cereri noi$/ })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await chimes(page)).toBe(before);
});

test('in English: the sound setting', async ({ page }) => {
  const { email: shop } = await createBookableShop(`Atelier Sound ${Date.now() % 100000}`, ['ulei']);
  await page.addInitScript(() => localStorage.setItem('sh_lang', 'en'));
  await signIn(page, shop, PASSWORD);
  await page.goto('/s/cont/setari/notificari');
  await expect(page.getByRole('switch', { name: /Sound for new bookings/ })).toBeChecked();
  await expect(page.getByText('On this device, while Service-Hub is open.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 't47-sound-setting-en', name());
});
