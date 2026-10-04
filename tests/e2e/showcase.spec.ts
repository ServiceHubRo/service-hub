import { expect, test } from '@playwright/test';
import { BACKEND, PASSWORD, createBookableShop, createUser, expectNoHorizontalScroll, serviceRest, shot, signIn, userIdOf } from './support';

// T28b — the shop's window: photos and facilities set by the owner, seen by clients on the shop
// page; facility filters and a map in search; the "answers quickly" note.

const name = () => test.info().project.name;
const tag = () => `${Date.now() % 100000}${Math.floor(Math.random() * 100)}`;

/** A small solid PNG the browser can decode (the app shrinks every photo before uploading). */
function png(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR4nO3NMQ0AAAgDsInBOhL5kQFHk/7NdJ2IWCwWi8VisVgsFov/xgt7ISsZwDJqDQAAAABJRU5ErkJggg==',
    'base64',
  );
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

test.describe('the shop window', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(150_000);

  test('photos and facilities by the owner; the client sees them, filters by them and finds the shop on the map', async ({ page, browser }) => {
    const shopName = `Atelier Vitrina ${tag()}`;
    const { email: owner, shopId } = await createBookableShop(shopName, ['ulei']);
    await serviceRest(`shops?id=eq.${shopId}`, 'PATCH', { latitude: 45.6427, longitude: 25.5887 });

    // The owner: Setări service → Poze și facilități.
    await signIn(page, owner, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou/);
    await page.goto('/s/cont/setari');
    await page.getByRole('link', { name: /Poze și facilități/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Poze și facilități' })).toBeVisible();
    await expect(page.getByText('0 din 10 poze')).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Adaugă poze' }).click();
    await (await chooser).setFiles([
      { name: 'atelier.png', mimeType: 'image/png', buffer: png() },
      { name: 'receptie.png', mimeType: 'image/png', buffer: png() },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('nu e poza') },
    ]);
    await page.getByRole('button', { name: 'Încarcă 3 poze' }).click();
    await expect(page.getByText('2 din 10 poze')).toBeVisible();
    await expect(page.getByText(/Unele fișiere nu au fost adăugate \(1\)/)).toBeVisible();
    const firstUrl = await page.getByRole('img', { name: 'Poza 1 a atelierului' }).getAttribute('src');
    await page.getByRole('button', { name: 'Mută poza 2 mai în față' }).click();
    await expect(page.getByRole('img', { name: 'Poza 2 a atelierului' })).toHaveAttribute('src', firstUrl!);
    await page.getByRole('button', { name: 'Șterge poza 2' }).click();
    await page.getByRole('button', { name: 'Da, șterge' }).click();
    await expect(page.getByText('1 din 10 poze')).toBeVisible();

    await page.getByLabel('Wi-Fi pentru clienți').check();
    await page.getByLabel('Mașină la schimb').check();
    await page.getByRole('button', { name: 'Salvează facilitățile' }).click();
    await expect(page.getByRole('button', { name: '✓ Salvat' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't28b-showcase', name());
    const [saved] = await serviceRest<{ amenities: string[] }[]>(`shops?id=eq.${shopId}&select=amenities`, 'GET');
    expect(saved!.amenities).toEqual(['wifi', 'courtesy_car']);

    // Three quick answers in the last days: the shop "usually answers within an hour".
    const someone = await createUser('client');
    const someoneId = await userIdOf(someone);
    for (let i = 0; i < 3; i++) {
      const day = new Date(Date.now() + (20 + i) * 86_400_000).toISOString().slice(0, 10);
      const created = new Date(Date.now() - (5 - i) * 86_400_000);
      await serviceRest('bookings', 'POST', {
        shop_id: shopId,
        client_id: someoneId,
        service_id: 'ulei',
        client_name: 'Maria Pop',
        car_snapshot: {},
        date: day,
        slot: '10:00',
        status: 'confirmed',
        created_at: created.toISOString(),
        confirmed_at: new Date(created.getTime() + 15 * 60_000).toISOString(),
      });
    }

    // The client: the facility filter, the card, the map.
    const client = await createUser('client');
    const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    const c = await context.newPage();
    await signIn(c, client, PASSWORD);
    await expect(c).toHaveURL(/\/c\/cauta/);
    await c.goto(`/c/cauta?q=${encodeURIComponent(shopName)}`);
    const card = c.locator('main li').filter({ hasText: shopName });
    await expect(card).toContainText('Răspunde de obicei în mai puțin de o oră');
    await c.getByRole('button', { name: 'Mașină la schimb' }).click();
    await expect(card).toBeVisible();
    await c.getByRole('button', { name: 'Cafea și apă' }).click();
    await expect(card).toHaveCount(0);
    await c.getByRole('button', { name: 'Cafea și apă' }).click();
    await expect(card).toBeVisible();

    await c.getByRole('button', { name: 'Hartă' }).click();
    await expect(c).toHaveURL(/vedere=harta/);
    await expect(c.getByRole('region', { name: 'Harta service-urilor găsite' })).toBeVisible();
    const pin = c.locator(`.leaflet-marker-icon[title="${shopName}"]`);
    await expect(pin).toBeVisible();
    await expectNoHorizontalScroll(c);
    await shot(c, 't28b-map', name());
    await pin.click();
    await c.getByRole('button', { name: 'Vezi service-ul' }).click();
    await expect(c.getByRole('heading', { level: 1, name: shopName })).toBeVisible();

    // The shop page: the small map, the photo, the facilities.
    await expect(c.getByRole('region', { name: `Harta cu ${shopName}` })).toBeVisible();
    await expect(c.getByText('Wi-Fi pentru clienți')).toBeVisible();
    await expect(c.getByText('Mașină la schimb')).toBeVisible();
    await expect(c.getByText('Răspunde de obicei în mai puțin de o oră')).toBeVisible();
    await expectNoHorizontalScroll(c);
    await shot(c, 't28b-shop-page', name());
    await c.getByRole('button', { name: 'Deschide poza 1 din 1' }).click();
    const viewer = c.getByRole('dialog', { name: `Poze cu ${shopName}` });
    await expect(viewer.getByRole('img', { name: `Poza 1 din 1, ${shopName}` })).toBeVisible();
    await c.keyboard.press('Escape');
    await expect(viewer).toBeHidden();

    // In English too.
    await c.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    await expect(c.getByText('Courtesy car')).toBeVisible();
    await expect(c.getByText('Usually answers within an hour')).toBeVisible();
    await context.close();
  });
});
