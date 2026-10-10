import { expect, test, type Page } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  serviceRest,
  shot,
  signIn,
  userIdOf,
  cardAction,
} from './support';

// Fișa mașinii (T27; shown by default since 10 Oct): the shop the client books with sees what was
// done on the car at other shops; it opens the car's file from the booking card and from Istoric and
// sees its own jobs (with amounts) and the other shops' jobs without price or shop name; the client
// turns it off or on again with one switch in Cont and the open file follows at once.

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

/** A finished job on the car, written straight to the test database. */
async function doneJob(shopId: string, clientId: string, plate: string, job: { work: string; cost: number; km: number; daysAgo: number; lines?: [string, number, boolean][] }) {
  const day = new Date(Date.now() - job.daysAgo * 86_400_000);
  const [booking] = await serviceRest<{ id: string }[]>('bookings', 'POST', {
    shop_id: shopId,
    client_id: clientId,
    service_id: 'frane',
    client_name: 'Ioana Test',
    car_snapshot: { make: 'Ford', model: 'Focus', year: 2017, plate, plate_norm: plate.replace(/\s/g, '') },
    date: day.toISOString().slice(0, 10),
    slot: '10:00',
    status: 'done',
    work: job.work,
    cost: job.cost,
    odometer: job.km,
    done_at: day.toISOString(),
  });
  if (job.lines) {
    const [quote] = await serviceRest<{ id: string }[]>('quotes', 'POST', {
      booking_id: booking!.id,
      version: 1,
      status: 'partially_accepted',
      inspection_fee: 0,
      total_sent: job.lines.reduce((sum, [, price]) => sum + price, 0),
      total_approved: job.cost,
    });
    await serviceRest(
      'quote_items',
      'POST',
      job.lines.map(([itemName, price, approved], i) => ({ quote_id: quote!.id, position: i + 1, name: itemName, price, approved })),
    );
  }
  return booking!.id;
}

async function openFileFromBookings(page: Page) {
  await page.goto('/s/programari');
  await (await cardAction(page.locator('li').filter({ hasText: 'Ford Focus' }), 'Fișa mașinii')).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Fișa mașinii' })).toBeVisible();
}

test.describe('Fișa mașinii', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test('shown by default, the shop sees the other shops’ jobs without price or name, until turned off in Cont', async ({ page, browser }) => {
    const id = tag();
    const plate = `BV ${10 + (Number(id) % 89)} FIS`;
    const otherName = `Service Altul ${id}`;
    const { shopId: otherShop } = await createBookableShop(otherName, ['frane']);
    const shopName = `Atelier Fișă ${id}`;
    const { email: shopEmail, shopId } = await createBookableShop(shopName, ['ulei', 'frane']);
    const clientEmail = await createUser('client');
    const clientId = await userIdOf(clientEmail);
    await doneJob(otherShop, clientId, plate, {
      work: 'Plăcuțe față schimbate',
      cost: 517,
      km: 98_300,
      daysAgo: 70,
      lines: [
        ['Plăcuțe frână față', 517, true],
        ['Discuri frână', 433, false],
      ],
    });
    await doneJob(shopId, clientId, plate, { work: 'Ulei și filtre', cost: 389, km: 101_250, daysAgo: 20 });

    // ------------------------------------------------------------ the client books (nothing to tick)
    const clientContext = await browser.newContext({ viewport: page.viewportSize() ?? undefined, hasTouch: true });
    await clientContext.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    const client = await clientContext.newPage();
    await signIn(client, clientEmail, PASSWORD);
    await expect(client).toHaveURL(/\/c\/cauta$/);
    await client.goto(`/c/cauta?q=${encodeURIComponent(shopName)}`);
    await client.locator('article').filter({ hasText: shopName }).getByRole('link').first().click();
    await client.getByRole('link', { name: 'Programează-te' }).click();
    await client.getByRole('button', { name: 'Schimb ulei + filtru ulei' }).click();
    await client.getByRole('button', { name: /^Continuă/ }).click();
    await client.getByRole('button', { name: /: \d+ loc(uri)?$/ }).first().click();
    await client.getByRole('button', { name: /^\d{2}:\d{2}$/, disabled: false }).first().click();
    await client.getByLabel('Marcă').fill('Ford');
    await client.getByLabel('Model').fill('Focus');
    await client.getByLabel('An fabricație').fill('2017');
    await client.getByLabel('Nr. înmatriculare').fill(plate);
    await expect(client.getByRole('switch', { name: /istoricul/i })).toHaveCount(0);
    await expectNoHorizontalScroll(client);
    await shot(client, 't27-booking-car', name());
    await client.getByRole('button', { name: 'Trimite cererea' }).click();
    await expect(client.getByRole('heading', { level: 1, name: 'Cerere trimisă' })).toBeVisible();
    const [made] = await serviceRest<{ share_history: boolean }[]>(
      `bookings?shop_id=eq.${shopId}&status=eq.pending&select=share_history`,
      'GET',
    );
    expect(made!.share_history).toBe(true);

    // ------------------------------------------------------------ the shop opens the file
    await signIn(page, shopEmail, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await page.goto('/s/programari');
    await expect(page.locator('li').filter({ hasText: 'Ford Focus' })).toBeVisible();
    await shot(page, 't27-shop-card', name());
    await openFileFromBookings(page);
    await expect(page.getByRole('link', { name: 'Fișa mașinii' })).toHaveCount(0);
    await expect(page.getByText(plate)).toBeVisible();
    await expect(page.getByText('Ultimul kilometraj cunoscut: 101.250 km')).toBeVisible();
    const own = page.getByRole('region', { name: new RegExp(`La ${shopName}`) });
    await expect(own).toContainText('Ulei și filtre');
    await expect(own).toContainText('389 lei');
    const others = page.getByRole('region', { name: /Reparații anterioare la alte service-uri/ });
    await expect(others).toContainText('Plăcuțe față schimbate');
    await expect(others).toContainText('98.300 km');
    await expect(others).toContainText('Plăcuțe frână față');
    // No price, no shop name, not even the line the client refused.
    await expect(others).not.toContainText('517');
    await expect(others).not.toContainText('lei');
    await expect(others).not.toContainText(otherName);
    await expect(others).not.toContainText('Discuri');
    await expectNoHorizontalScroll(page);
    await shot(page, 't27-vehicle-file', name());

    // ------------------------------------------------------------ the client turns it off in Cont: the file follows
    await client.getByRole('link', { name: 'Vezi programările' }).click();
    await expect(client.getByRole('switch', { name: /istoricul/i })).toHaveCount(0);
    await client.getByRole('link', { name: 'Cont', exact: true }).filter({ visible: true }).first().click();
    const share = client.getByRole('group', { name: 'Istoricul mașinii pentru service-uri' });
    await expect(share.getByRole('switch')).toBeChecked();
    await expect(share).toContainText('fără prețuri și fără numele lor');
    await share.scrollIntoViewIfNeeded();
    await shot(client, 't27-client-share-on', name());
    await share.getByRole('switch').uncheck();
    await expect(share).toContainText('Service-urile văd doar lucrările făcute la ele.');
    await expectNoHorizontalScroll(client);
    await shot(client, 't27-client-share-off', name());
    await expect(others).toContainText('Clientul a ales să nu arate lucrările de la alte service-uri.');
    await expect(others).not.toContainText('Plăcuțe față schimbate');
    await expect(own).toContainText('Ulei și filtre');
    await shot(page, 't27-vehicle-file-hidden', name());

    await share.getByRole('switch').check();
    await expect(share).toContainText('fără prețuri și fără numele lor');
    await expect(others).toContainText('Plăcuțe față schimbate');
    await client.goto('/c/programari');

    // ------------------------------------------------------------ from Istoric, and in English
    await page.goto('/s/istoric');
    const job = page.locator('li').filter({ hasText: 'Ulei și filtre' });
    await job.getByRole('button').first().click();
    await (await cardAction(job, 'Fișa mașinii')).click();
    await expect(page).toHaveURL(/\/s\/istoric\/fisa\//);
    await expect(page.getByRole('region', { name: /Reparații anterioare la alte service-uri/ })).toContainText('Plăcuțe față schimbate');
    await page.getByRole('link', { name: 'Istoric' }).first().click();
    await expect(page).toHaveURL(/\/s\/istoric$/);

    await serviceRest(`profiles?id=eq.${await userIdOf(shopEmail)}`, 'PATCH', { lang: 'en' });
    await openFileFromBookingsEn(page);
    await expect(page.getByText('Last known odometer: 101,250 km')).toBeVisible();
    await expect(page.getByRole('region', { name: /Previous repairs at other shops/ })).toContainText('without prices or shop names');
    await expect(page.getByRole('region', { name: new RegExp(`At ${shopName}`) })).toContainText('389 RON');
    await expectNoHorizontalScroll(page);
    await shot(page, 't27-vehicle-file-en', name());

    // The client cancels: nothing of the other shops stays visible.
    await (await cardAction(client.locator('li').filter({ hasText: shopName }), 'Anulează')).click();
    await client.getByRole('button', { name: 'Anulează programarea' }).click();
    await expect(page.getByRole('region', { name: /Previous repairs at other shops/ })).toContainText('while the client has an open booking');
    await expect(page.getByRole('region', { name: /Previous repairs at other shops/ })).not.toContainText('Plăcuțe față schimbate');
    await clientContext.close();
  });
});

async function openFileFromBookingsEn(page: Page) {
  await page.goto('/s/programari');
  await (await cardAction(page.locator('li').filter({ hasText: 'Ford Focus' }), 'Vehicle file')).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vehicle file' })).toBeVisible();
}
