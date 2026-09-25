import { expect, test, type Browser } from '@playwright/test';
import { formatDate } from '../../src/i18n/format';
import { BACKEND, PASSWORD, createBookableShop, createUser, rpcAs, signIn } from './support';

// T18 / P17b: a booking at 09:00 means 09:00 at the shop in Brașov. Opened from a phone set to
// the US or Japan, every screen still shows 09:00 on the same day, and message times are Romanian
// time. (All other browser tests run with the device in Germany.)

test.skip(!BACKEND, 'needs the local Supabase stack');

const rid = () => crypto.randomUUID();

interface Day {
  date: string;
  bookable: boolean;
}
interface Slot {
  time: string;
  available: boolean;
}

/** The first day with 09:00 free. */
async function nineOClock(email: string, shopId: string): Promise<string> {
  const av = await rpcAs<{ days: Day[] }>(email, 'get_availability', { p_shop_id: shopId, p_days: 30 });
  for (const day of av.days.filter((d) => d.bookable)) {
    const s = await rpcAs<{ slots: Slot[] }>(email, 'get_availability', { p_shop_id: shopId, p_from: day.date, p_days: 1, p_slots_for: day.date });
    if (s.slots.some((x) => x.time === '09:00' && x.available)) return day.date;
  }
  throw new Error('no free 09:00');
}

/** HH:MM in Bucharest now and a minute later (a message sent in between shows one of them). */
function bucharestNow(): string[] {
  const at = (d: Date) =>
    new Intl.DateTimeFormat('ro-RO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Bucharest' }).format(d);
  const now = new Date();
  return [at(now), at(new Date(now.getTime() + 60_000))];
}

async function openAs(browser: Browser, email: string, timezoneId: string, viewport: { width: number; height: number } | null) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport, timezoneId });
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
  const page = await context.newPage();
  await signIn(page, email, PASSWORD);
  await expect(page).not.toHaveURL(/\/intra/);
  return page;
}

for (const timezoneId of ['America/Los_Angeles', 'America/New_York', 'Asia/Tokyo']) {
  test(`a 09:00 booking shows 09:00 with the device in ${timezoneId}`, async ({ browser, page }) => {
    const { email: shop, shopId } = await createBookableShop(`Atelier Fus ${Date.now()}`, ['frane']);
    const client = await createUser('client');
    const date = await nineOClock(client, shopId);
    const booking = await rpcAs<{ id: string; ref: string }>(client, 'create_booking', {
      p_shop_id: shopId,
      p_service_id: 'frane',
      p_date: date,
      p_slot: '09:00',
      p_request_id: rid(),
      p_car: { make: 'Dacia', model: 'Logan', year: 2019, plate: 'BV 09 TZZ' },
      p_save_car: false,
    });
    await rpcAs(shop, 'confirm_booking', { p_booking_id: booking.id, p_request_id: rid() });
    const day = formatDate('ro', date);

    // The client, far from Romania.
    const cx = await openAs(browser, client, timezoneId, page.viewportSize());
    expect(await cx.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(timezoneId);
    await cx.goto('/c/programari');
    const card = cx.getByRole('listitem').filter({ hasText: 'Dacia Logan' }).first();
    await expect(card).toContainText('09:00');
    await expect(card).toContainText(day);

    // The automatic message of the confirmation names the same day and hour; a message sent now
    // carries the Romanian time.
    await cx.goto(`/c/mesaje/programare/${booking.id}`);
    const log = cx.getByRole('log');
    await expect(log).toContainText(`Programarea ${booking.ref} e confirmată:`);
    await expect(log).toContainText('09:00');
    const expected = bucharestNow();
    await cx.getByLabel('Mesaj', { exact: true }).fill('Vin la 09:00.');
    await cx.getByRole('button', { name: 'Trimite' }).click();
    const sent = log.getByRole('listitem').filter({ hasText: 'Vin la 09:00.' }).last();
    await expect(sent).toBeVisible();
    await expect(sent).toContainText(new RegExp(expected.join('|')));

    // The booking screen offers 09:00 on that day, as a slot of the shop's day.
    await cx.goto(`/c/service/${shopId}`);
    await cx.getByRole('link', { name: 'Programează-te' }).click();
    await cx.getByRole('button', { name: 'Plăcuțe de frână' }).click();
    await cx.getByRole('button', { name: new RegExp(`^${day}:`) }).click();
    await expect(cx.getByRole('button', { name: /^09:00/ })).toBeVisible();
    await expect(cx.getByRole('button', { name: /^08:00/ })).toBeVisible();
    await cx.context().close();

    // The shop, from the same zone.
    const sx = await openAs(browser, shop, timezoneId, page.viewportSize());
    await sx.goto('/s/programari?tab=programate');
    const row = sx.getByRole('listitem').filter({ hasText: 'BV 09 TZZ' }).first();
    await expect(row).toContainText('09:00');
    await sx.context().close();
  });
}
