import { expect, test } from '@playwright/test';
import { BACKEND, PASSWORD, createBookableShop, createUser, expectNoHorizontalScroll, serviceRest, shot, signIn } from './support';

// Offers, completed (Eduard, 8 Oct): the new-client offer with a last day and chosen services, the
// quiet-day offer; the "Doar cu ofertă" filter and the badges; "-15%" on the quiet days of step 2
// while they have places, gone once the day is full; the shop sees which offer it promised.

const name = () => test.info().project.name;
const tag = () => `${Date.now() % 100000}${Math.floor(Math.random() * 100)}`;
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

test.describe('offers: last day, services, quiet days', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test('the owner sets them; a client filters, sees the badges, books a quiet day that then fills', async ({ page, browser }) => {
    const shopName = `Atelier Zile ${tag()}`;
    // One car a day, so a booked day is full.
    const { email: owner, shopId } = await createBookableShop(shopName, ['ulei', 'frane'], { daily_capacity: 1 });

    // ------------------------------------------------------------ the owner, Setări → Reguli
    await signIn(page, owner, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await page.goto('/s/cont/setari/reguli');
    const offer = page.getByRole('group', { name: 'Ofertă pentru clienți noi' });
    await offer.getByRole('button', { name: '-10%' }).click();
    await page.getByLabel('Valabilă până pe (opțional)').fill(inDays(40));
    await offer.getByRole('button', { name: 'Doar la anumite servicii' }).click();
    await page.getByRole('button', { name: 'Salvează regulile' }).click();
    await expect(page.getByText('Alege cel puțin un serviciu.')).toBeVisible();
    await page.getByLabel('Schimb ulei + filtru ulei').check();
    const quiet = page.getByRole('group', { name: 'Reducere în zilele mai liniștite' });
    await quiet.getByRole('button', { name: '-15%' }).click();
    for (const day of ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri']) await quiet.getByRole('button', { name: day }).click();
    await quiet.scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 'offers-settings', name());
    await page.getByRole('button', { name: 'Salvează regulile' }).click();
    await expect(page.getByRole('button', { name: /Salvat/ })).toBeVisible();
    const [saved] = await serviceRest<{ new_client_offer_until: string; new_client_offer_services: string[]; quiet_day_offer: number; quiet_days: number[] }[]>(
      `shops?id=eq.${shopId}&select=new_client_offer_until,new_client_offer_services,quiet_day_offer,quiet_days`,
      'GET',
    );
    expect(saved).toEqual({ new_client_offer_until: inDays(40), new_client_offer_services: ['ulei'], quiet_day_offer: 15, quiet_days: [1, 2, 3, 4, 5] });

    // ------------------------------------------------------------ a new client: filter and badges
    const ctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    await ctx.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    const c = await ctx.newPage();
    await signIn(c, await createUser('client'), PASSWORD);
    await expect(c).toHaveURL(/\/c\/cauta$/);
    await c.goto(`/c/cauta?q=${encodeURIComponent(shopName)}&oferta=1`);
    const card = c.locator('article').filter({ hasText: shopName });
    await expect(card).toContainText(/-10% la manoperă la prima programare, până pe \d+ [a-z]+/);
    await expect(card).toContainText('-15% la manoperă lunea, marțea, miercurea, joia și vinerea');
    await expect(c.getByText('Doar cu ofertă').first()).toBeVisible(); // the chosen filter, shown with its ✕
    await expectNoHorizontalScroll(c);
    await shot(c, 'offers-search', name());

    await card.getByRole('link').first().click();
    await expect(c.getByText('La: Schimb ulei + filtru ulei.', { exact: false })).toBeVisible();
    await expect(c.getByText('Zile cu reducere')).toBeVisible();
    await shot(c, 'offers-shop-page', name());

    // Step 2: every weekday with places shows -15 %; book the first one.
    await c.getByRole('link', { name: 'Programează-te' }).click();
    await c.getByRole('button', { name: /^Plăcuțe de frână|^Frâne/ }).first().click();
    await c.getByRole('button', { name: /^Continuă/ }).click();
    const quietDay = c.getByRole('button', { name: /: 1 loc, reducere de 15%$/ }).first();
    await expect(quietDay).toBeVisible();
    await expect(quietDay).toContainText('-15%');
    await expectNoHorizontalScroll(c);
    await shot(c, 'offers-days', name());
    const dayLabel = (await quietDay.getAttribute('aria-label'))!;
    const date = dayLabel.split(':')[0]!;
    await quietDay.click();
    await c.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();
    await c.getByLabel('Marcă').fill('Dacia');
    await c.getByLabel('Model').fill('Logan');
    // Brakes are not in the new-client offer: the quiet day applies.
    await expect(c.getByText('Zi cu reducere: -15% la manoperă.', { exact: false })).toBeVisible();
    await c.getByRole('button', { name: 'Trimite cererea' }).click();
    await expect(c).toHaveURL(/\/programare\/trimisa/);
    const [booking] = await serviceRest<{ offer_percent: number; offer_kind: string }[]>(
      `bookings?shop_id=eq.${shopId}&select=offer_percent,offer_kind`,
      'GET',
    );
    expect(booking).toEqual({ offer_percent: 15, offer_kind: 'quiet_day' });

    // That day is now full: no offer on it for the next client.
    const ctx2 = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    await ctx2.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    const c2 = await ctx2.newPage();
    await signIn(c2, await createUser('client'), PASSWORD);
    await expect(c2).toHaveURL(/\/c\/cauta$/);
    await c2.goto(`/c/service/${shopId}/programare`);
    await c2.getByRole('button', { name: /^Schimb ulei/ }).click();
    await c2.getByRole('button', { name: /^Continuă/ }).click();
    const full = c2.getByRole('button', { name: new RegExp(`^${date}:`) });
    await expect(full).toBeDisabled();
    await expect(full).not.toContainText('-15%');
    await shot(c2, 'offers-day-full', name());

    // The shop sees which offer it promised.
    await page.goto('/s/programari?tab=cereri');
    await expect(page.getByText('Zi cu reducere: i-ai promis -15% la manoperă')).toBeVisible();
    await ctx.close();
    await ctx2.close();
  });
});
