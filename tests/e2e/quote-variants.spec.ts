import { expect, test, type Browser, type Page } from '@playwright/test';
import { BACKEND, PASSWORD, cardAction, createBookableShop, createUser, expectNoHorizontalScroll, rpcAs, shot, signIn } from './support';

// T37c — a quote line with an original and an alternative part: the shop adds the alternative in
// the composer, the client picks it and accepts, the shop sees which variant was taken.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

const name = () => test.info().project.name;
const rid = () => crypto.randomUUID();
const clientCard = (page: Page, ref: string) => page.locator('main section li').filter({ hasText: ref }).first();
const shopCard = (page: Page, ref: string) => page.locator('main ul[aria-label] > li').filter({ hasText: ref });

async function freeSlot(email: string, shopId: string): Promise<{ date: string; slot: string }> {
  const av = await rpcAs<{ days: { date: string; bookable: boolean }[] }>(email, 'get_availability', { p_shop_id: shopId, p_days: 30 });
  for (const day of av.days.filter((d) => d.bookable)) {
    const s = await rpcAs<{ slots: { time: string; available: boolean }[] }>(email, 'get_availability', {
      p_shop_id: shopId,
      p_from: day.date,
      p_days: 1,
      p_slots_for: day.date,
    });
    const free = s.slots.find((x) => x.available);
    if (free) return { date: day.date, slot: free.time };
  }
  throw new Error('no free slot');
}

async function signedIn(browser: Browser, page: Page, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
  const other = await context.newPage();
  await signIn(other, email, PASSWORD);
  await expect(other).toHaveURL(/\/(c|s)\//);
  return other;
}

test.describe('quote variants', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test('the shop offers an alternative part, the client picks it, the shop sees the choice', async ({ page, browser }) => {
    const { email: shop, shopId } = await createBookableShop(`Atelier T37c ${Date.now()}`, ['frane']);
    const client = await createUser('client');
    const at = await freeSlot(client, shopId);
    const booking = await rpcAs<{ id: string; ref: string }>(client, 'create_booking', {
      p_shop_id: shopId,
      p_service_id: 'frane',
      p_date: at.date,
      p_slot: at.slot,
      p_request_id: rid(),
      p_car: { make: 'Dacia', model: 'Logan', year: 2019, plate: 'BV 37 ALT' },
      p_save_car: false,
    });
    await rpcAs(shop, 'confirm_booking', { p_booking_id: booking.id, p_request_id: rid() });
    await rpcAs(shop, 'start_inspection', { p_booking_id: booking.id, p_request_id: rid() });

    // The shop: a line with an original and an alternative part, and a plain line.
    await signIn(page, shop, PASSWORD);
    await expect(page).toHaveURL(/\/s\//);
    await page.goto('/s/programari?tab=programate');
    const card = shopCard(page, booking.ref);
    await (await cardAction(card, 'Trimite deviz')).click();
    await page.getByLabel('Poziția 1', { exact: true }).fill('Plăcuțe frână față');
    await page.getByLabel('Preț, lei').first().fill('420');
    await page.getByRole('button', { name: 'Piesă alternativă' }).click();
    await expect(page.getByLabel('Alternativă, lei')).toBeFocused();
    await expect(page.getByLabel('Originală, lei')).toHaveValue('420');
    await page.getByLabel('Alternativă, lei').fill('260');
    await page.getByLabel('Marca (opțional)').fill('Bosch');
    await page.getByRole('button', { name: 'Adaugă poziție' }).click();
    await page.getByLabel('Poziția 2', { exact: true }).fill('Manoperă');
    await page.getByLabel('Preț, lei').first().fill('150');
    await expect(page.getByText('570 lei')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't37c-composer-ro', name());
    await page.getByRole('button', { name: 'Trimite devizul' }).click();
    await expect(card).toContainText('Piesă originală');
    await expect(card).toContainText('Piesă alternativă, Bosch');

    // The client: the original is picked at first; the alternative changes the total.
    const clientPage = await signedIn(browser, page, client);
    await clientPage.goto('/c/programari');
    const quote = clientCard(clientPage, booking.ref);
    const original = quote.getByRole('radio', { name: /^Piesă originală/ });
    const alternative = quote.getByRole('radio', { name: /^Piesă alternativă, Bosch/ });
    await expect(original).toBeChecked();
    await expect(quote).toContainText('570 lei');
    await alternative.check();
    await expect(original).not.toBeChecked();
    await expect(quote).toContainText('410 lei');
    // Leaving the line out and taking it back keeps the alternative.
    await quote.getByRole('checkbox', { name: /Plăcuțe frână față/ }).uncheck();
    await expect(alternative).toBeDisabled();
    await expect(quote.getByRole('button', { name: 'Accept selectate' })).toBeVisible();
    await quote.getByRole('checkbox', { name: /Plăcuțe frână față/ }).check();
    await expect(alternative).toBeChecked();
    await expect(quote.getByRole('button', { name: 'Accept', exact: true })).toBeVisible();
    await expectNoHorizontalScroll(clientPage);
    await shot(clientPage, 't37c-client-ro', name());
    await clientPage.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    await expect(quote.getByRole('radio', { name: /^Alternative part, Bosch/ })).toBeChecked();
    await shot(clientPage, 't37c-client-en', name());
    await quote.getByRole('button', { name: 'Accept', exact: true }).click();

    // The shop: the alternative taken, the original struck through, the total of the choice.
    await expect(card).toContainText('410 lei');
    await expect(card).toContainText('refuzată de client');
    await expectNoHorizontalScroll(page);
    await shot(page, 't37c-shop-decided-ro', name());
    await clientPage.context().close();
  });
});
