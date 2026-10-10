import { expect, test } from '@playwright/test';
import { BACKEND, PASSWORD, closeFilters, createBookableShop, createUser, expectNoHorizontalScroll, openFilters, rpcAs, serviceRest, shot, signIn, userIdOf, cardAction, selectInPanel } from './support';

// T28a — "like Booking, for car shops": the owner turns on instant confirmation; a client sees in
// search which shops are free on a day and which confirm at once, opens the shop on its first
// free place, books it in one go and is confirmed on the spot, with "Adaugă în calendar" and
// "Indicații".

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

test.describe('instant booking', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(150_000);

  test('the owner turns it on; a client finds the free place, books it and is confirmed at once', async ({ page, browser }) => {
    const shopName = `Atelier Instant ${tag()}`;
    const { email: owner, shopId } = await createBookableShop(shopName, ['ulei']);
    const ownerId = await userIdOf(owner);

    // The owner: Reguli de programare → Confirmare instantă.
    await signIn(page, owner, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou/);
    await page.goto('/s/cont/setari/reguli');
    const instant = page.getByLabel('Confirmare instantă');
    await expect(instant).not.toBeChecked();
    await expect(page.getByText(/Cererile pentru locurile libere se confirmă singure/)).toBeVisible();
    await instant.check();
    await page.getByRole('button', { name: 'Salvează regulile' }).click();
    await expect(page.getByRole('button', { name: '✓ Salvat' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't28-rules-instant', name());
    const [saved] = await serviceRest<{ auto_confirm: boolean }[]>(`shops?id=eq.${shopId}&select=auto_confirm`, 'GET');
    expect(saved!.auto_confirm).toBe(true);

    // The client, in another browser.
    const client = await createUser('client');
    const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    const c = await context.newPage();
    await signIn(c, client, PASSWORD);
    await expect(c).toHaveURL(/\/c\/cauta/);
    const [extras] = await rpcAs<{ free_date: string; free_slot: string }[]>(client, 'search_card_extras', { p_shop_ids: [shopId] });
    const free = extras!;

    // Search: the card says when it is free and that it confirms at once; the filters narrow.
    await c.goto(`/c/cauta?q=${encodeURIComponent(shopName)}`);
    const card = c.locator('main li').filter({ hasText: shopName });
    await expect(card).toContainText('Confirmare instantă');
    await expect(card).toContainText(/Liber .+, de la \d{2}:\d{2}/);
    await openFilters(c);
    await c.getByRole('switch', { name: 'Confirmare instantă' }).check();
    await selectInPanel(c, 'Altă zi');
    await c.getByLabel('Ziua').fill(free.free_date);
    await expect(c).toHaveURL(new RegExp(`zi=${free.free_date}`));
    await closeFilters(c);
    await expect(c.locator('p').filter({ hasText: 'Filtre alese:' })).toContainText('Confirmare instantă');
    await expect(card).toContainText(`de la ${free.free_slot}`);
    await expectNoHorizontalScroll(c);
    await shot(c, 't28-search-day', name());

    // The shop page, on that day: the free place, directions, and the button straight to it.
    await card.getByRole('link').first().click();
    await expect(c).toHaveURL(new RegExp(`/c/service/${shopId}\\?zi=${free.free_date}`));
    // The shop page itself, loaded (the search card under it also says "de la …" until it is replaced).
    await expect(c.getByRole('heading', { level: 1, name: shopName })).toBeVisible({ timeout: 15_000 });
    await expect(c.getByText(`de la ${free.free_slot}`).first()).toBeVisible();
    await expect(c.getByRole('link', { name: 'Indicații' })).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/);
    await expectNoHorizontalScroll(c);
    await shot(c, 't28-shop-free', name());
    // "Programează-te" opens on the day asked, so another time can be picked; the free place has its own button.
    await expect(c.getByRole('link', { name: 'Programează-te' })).toHaveAttribute('href', `/c/service/${shopId}/programare?zi=${free.free_date}`);
    await c.getByRole('link', { name: new RegExp(`^Rezervă: .+, ${free.free_slot}$`) }).click();
    await expect.poll(() => new URL(c.url()).searchParams.get('ora')).toBe(free.free_slot);
    expect(new URL(c.url()).searchParams.get('zi')).toBe(free.free_date);

    // The service, then straight to the last step: the day and time are already chosen.
    await c.getByRole('button', { name: 'Schimb ulei + filtru ulei' }).click();
    await c.getByRole('button', { name: /^Continuă/ }).click();
    await expect(c.getByRole('heading', { level: 1, name: 'Mașina' })).toBeVisible();
    await expect(c.getByText(`, ${free.free_slot}`).first()).toBeVisible();
    await expect(c.getByText('Programarea se confirmă imediat.')).toBeVisible();
    await c.getByLabel('Marcă').fill('Dacia');
    await c.getByLabel('Model').fill('Logan');
    await shot(c, 't28-step4-instant', name());
    await c.getByRole('button', { name: 'Rezervă acum' }).click();

    // Confirmed on the spot.
    await expect(c.getByRole('heading', { level: 1, name: 'Programarea e confirmată' })).toBeVisible();
    const download = c.waitForEvent('download');
    await c.getByRole('button', { name: 'Adaugă în calendar' }).click();
    expect((await download).suggestedFilename()).toBe(`service-hub-${free.free_date}.ics`);
    await expectNoHorizontalScroll(c);
    await shot(c, 't28-confirmed', name());

    const [booking] = await serviceRest<{ id: string; status: string }[]>(`bookings?shop_id=eq.${shopId}&select=id,status`, 'GET');
    expect(booking!.status).toBe('confirmed');
    const events = await serviceRest<{ event: string }[]>(
      `notification_events?user_id=eq.${ownerId}&booking_id=eq.${booking!.id}&select=event`,
      'GET',
    );
    expect(events.map((e) => e.event)).toEqual(['booking_auto_confirmed']);

    // Programări: confirmed, with the calendar and the way there.
    await c.goto('/c/programari');
    const mine = c.locator('main li').filter({ hasText: shopName });
    await expect(mine).toContainText('Confirmată');
    await expect(await cardAction(mine, 'Adaugă în calendar')).toBeVisible();
    await expect(mine.getByRole('menuitem', { name: 'Indicații' })).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\//);
    await shot(c, 't28-bookings', name());

    // In English too.
    await c.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    await expect(await cardAction(mine, 'Add to calendar')).toBeVisible();
    await expect(mine.getByRole('menuitem', { name: 'Directions' })).toBeVisible();
    await context.close();
  });
});
