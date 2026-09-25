import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  BACKEND,
  PASSWORD,
  SEED,
  SEED_PASSWORD,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  openAccount,
  rpcAs,
  serviceRest,
  shot,
  signIn,
  userIdOf,
} from './support';

// T17 — Rapoarte: the owner's tile in Cont, the periods, figures that match Istoric, the CSV; the
// "too few jobs" state that turns into the reports live when the third job is finished (English).

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
const navLink = (page: Page, label: string) =>
  page.getByRole('link', { name: label, exact: true }).filter({ visible: true }).first();
/** The big figure of a headline card, found by its label. */
const stat = (page: Page, label: string) =>
  page.locator('main li').filter({ has: page.getByText(label, { exact: true }) }).locator('span').first();
const scrollMain = (page: Page, to: 'top' | 'bottom') =>
  page.locator('main').evaluate((el, where) => el.scrollTo(0, where === 'top' ? 0 : el.scrollHeight), to);

test.describe('demo shop', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('Rapoarte: tile in Cont, periods, the same figures as Istoric, CSV (nothing is changed)', async ({ page }) => {
    await signIn(page, SEED.shop, SEED_PASSWORD);
    await openAccount(page);
    await page.getByRole('link', { name: /^Rapoarte/ }).click();
    await expect(page).toHaveURL(/\/s\/cont\/rapoarte$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Rapoarte' })).toBeVisible();

    // This month by default, against the same days of last month.
    await expect(page.getByRole('button', { name: 'Luna aceasta', pressed: true })).toBeVisible();
    await expect(page.getByText(/^Comparat cu \d+ \S+ – \d+ \S+\.$/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Încasări pe lună/ })).toBeVisible();
    // The chart's figures are there for screen readers too: always 12 months.
    await expect(page.locator('main table tbody tr')).toHaveCount(12);
    await expect(page.getByRole('heading', { name: 'Lucrări pe tip de serviciu' })).toBeVisible();
    await expect(page.getByText('Clienți care au revenit')).toBeVisible();
    await expect(page.getByText('Rata de acceptare')).toBeVisible();
    await expect(page.getByText('Cea mai aglomerată zi')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't17-rapoarte', name());
    await scrollMain(page, 'bottom');
    await shot(page, 't17-rapoarte-jos', name());
    await scrollMain(page, 'top');

    // "Ultimele 3 luni": a year of work in the demo data, so every section has figures.
    await page.getByRole('button', { name: 'Ultimele 3 luni' }).click();
    await expect(page).toHaveURL(/perioada=quarter/);
    await expect(page.getByRole('button', { name: 'Ultimele 3 luni', pressed: true })).toBeVisible();
    await expect(page.getByText(/Crește cu|Scade cu|La fel|Înainte: 0/).first()).toBeVisible();
    await expect(page.getByText(/\d+ acceptate din \d+/)).toBeVisible();
    const revenue = (await stat(page, 'Încasat (lei)').textContent())!.trim();
    const jobs = (await stat(page, 'Lucrări').textContent())!.trim();
    expect(Number(jobs)).toBeGreaterThanOrEqual(3);
    await expectNoHorizontalScroll(page);
    await shot(page, 't17-rapoarte-3-luni', name());

    // The CSV of the period, for the accountant: finished jobs and inspection fees.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Descarcă datele (CSV)' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^rapoarte-ultimele-3-luni-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv.split('\r\n')[0]).toBe('﻿Data;Cod programare;Tip;Număr;Mașină;Client;Serviciu;Sumă (lei)');
    expect(csv.match(/;Lucrare;/g)?.length).toBe(Number(jobs));
    expect(csv).toContain(';Taxă de constatare;');

    // "Tot" has nothing to compare with.
    await page.getByRole('button', { name: 'Tot', exact: true }).click();
    await expect(page).toHaveURL(/perioada=all/);
    await expect(page.getByText(/^Comparat cu/)).toHaveCount(0);

    // Istoric on the same period shows the same takings and the same number of jobs.
    await navLink(page, 'Istoric').click();
    await page.getByRole('button', { name: 'Ultimele 3 luni' }).click();
    const escaped = revenue.replace(/\./g, '\\.');
    await expect(page.getByText(new RegExp(`^${jobs} (de )?reparații · ${escaped} lei încasat$`))).toBeVisible();

    // Back to Rapoarte: the period stayed in the address.
    await page.goBack();
    await expect(page.getByRole('button', { name: 'Tot', pressed: true })).toBeVisible();
  });
});

async function freeSlot(client: string, shopId: string, count: number): Promise<{ date: string; slot: string }[]> {
  const av = await rpcAs<{ days: { date: string; bookable: boolean }[] }>(client, 'get_availability', { p_shop_id: shopId, p_days: 30 });
  const out: { date: string; slot: string }[] = [];
  for (const day of av.days.filter((d) => d.bookable)) {
    const s = await rpcAs<{ slots: { time: string; available: boolean }[] }>(client, 'get_availability', {
      p_shop_id: shopId,
      p_from: day.date,
      p_days: 1,
      p_slots_for: day.date,
    });
    for (const slot of s.slots.filter((x) => x.available)) {
      out.push({ date: day.date, slot: slot.time });
      if (out.length === count) return out;
    }
  }
  throw new Error('not enough free slots');
}

/** A booking taken all the way to "done" (or to a refused quote), through the real functions. */
async function job(shop: string, client: string, shopId: string, at: { date: string; slot: string }, accept: boolean, km: number) {
  // A plate of its own per shop: the odometer is checked against every earlier job on a plate.
  const plate = `BV ${shopId.slice(0, 2).toUpperCase()} ${shopId.slice(2, 5).toUpperCase().replace(/[^A-Z]/g, 'X')}`;
  const b = await rpcAs<{ id: string }>(client, 'create_booking', {
    p_shop_id: shopId,
    p_service_id: 'frane',
    p_date: at.date,
    p_slot: at.slot,
    p_request_id: rid(),
    p_car: { make: 'Dacia', model: 'Logan', year: 2019, plate },
    p_save_car: false,
  });
  await rpcAs(shop, 'confirm_booking', { p_booking_id: b.id, p_request_id: rid() });
  await rpcAs(shop, 'start_inspection', { p_booking_id: b.id, p_request_id: rid() });
  await rpcAs(shop, 'send_quote', {
    p_booking_id: b.id,
    p_items: [
      { name: 'Plăcuțe frână față', price: 280 },
      { name: 'Manoperă', price: 150 },
    ],
    p_request_id: rid(),
  });
  const [quote] = await serviceRest<{ id: string; quote_items: { id: string }[] }[]>(
    `quotes?booking_id=eq.${b.id}&status=eq.sent&select=id,quote_items(id)`,
    'GET',
  );
  await rpcAs(client, 'decide_quote', {
    p_booking_id: b.id,
    p_quote_id: quote!.id,
    p_approved_item_ids: accept ? quote!.quote_items.map((i) => i.id) : [],
    p_request_id: rid(),
  });
  if (!accept) return;
  await rpcAs(shop, 'start_work', { p_booking_id: b.id, p_request_id: rid() });
  await rpcAs(shop, 'complete_job', { p_booking_id: b.id, p_odometer: km, p_work: 'Plăcuțe schimbate', p_request_id: rid() });
}

test.describe('new shop', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test('English: too few jobs, then the reports appear live with the third one', async ({ page }) => {
    const { email: shop, shopId } = await createBookableShop(`Reports T17 ${Date.now()}`, ['frane'], { inspection_fee: 100 }, { lang: 'en' });
    const client = await createUser('client');
    const [a, b, c, d, e] = await freeSlot(client, shopId, 5);
    await job(shop, client, shopId, a!, true, 100000);
    await job(shop, client, shopId, b!, true, 101000);
    await job(shop, client, shopId, c!, false, 0);
    await job(shop, client, shopId, e!, false, 0);

    // The shop's profile is in English, so the app switches to it after signing in.
    await signIn(page, shop, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await page.getByRole('link', { name: 'Account', exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('link', { name: /^Reports/ }).click();
    await expect(page.getByText('Not enough jobs yet')).toBeVisible();
    await expect(page.getByText('Reports fill up as you complete jobs. Come back in a few weeks.')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't17-reports-empty-en', name());

    // The third job finished on another device: the reports appear without a reload.
    await job(shop, client, shopId, d!, true, 102000);
    await expect(page.getByRole('button', { name: 'This month', pressed: true })).toBeVisible({ timeout: 15_000 });
    // Revenue and average in RON; one returning customer (three jobs); three of five quotes accepted.
    await expect(stat(page, 'Revenue (RON)')).toHaveText('1,290');
    await expect(stat(page, 'Jobs')).toHaveText('3');
    await expect(stat(page, 'Average job (RON)')).toHaveText('430');
    await expect(page.getByText('Before: 0').first()).toBeVisible();
    await expect(page.getByText('Returning customers')).toBeVisible();
    await expect(page.getByText('3 of 5 accepted')).toBeVisible();
    await expect(page.getByText('Below 70% usually means prices are too high', { exact: false })).toBeVisible();
    await expect(page.getByText('200 RON', { exact: true })).toBeVisible(); // two inspection fees
    await expectNoHorizontalScroll(page);
    await shot(page, 't17-reports-en', name());
    await scrollMain(page, 'bottom');
    await shot(page, 't17-reports-en-bottom', name());
  });

  test('a staff member has no Rapoarte tile and the screen says it is the owner’s; Istoric without the takings', async ({ page, browser }) => {
    const { email: shop, shopId } = await createBookableShop(`Staff T17 ${Date.now()}`, ['frane']);
    const client = await createUser('client');
    const [a] = await freeSlot(client, shopId, 1);
    await job(shop, client, shopId, a!, true, 100000);
    const staff = await createUser('client', { name: 'Vlad Coleg' });
    const me = await userIdOf(staff);
    await serviceRest(`profiles?id=eq.${me}`, 'PATCH', { role: 'shop' });
    await serviceRest('shop_staff', 'POST', [
      { shop_id: shopId, user_id: me, invited_email: staff, role: 'staff', invite_token_hash: rid(), accepted_at: new Date().toISOString() },
    ]);

    await signIn(page, staff, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await openAccount(page);
    await expect(page.getByRole('link', { name: /Setări service/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Rapoarte/ })).toHaveCount(0);
    await page.goto('/s/cont/rapoarte');
    await expect(page.getByText('Doar proprietarul service-ului vede rapoartele.')).toBeVisible();
    await shot(page, 't17-rapoarte-personal', name());

    // Istoric: the job and its amount (a colleague writes the quotes), the count, no total, no CSV.
    await page.goto('/s/istoric');
    await expect(page.getByText('1 reparație', { exact: true })).toBeVisible();
    await expect(page.getByText(/încasat/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Descarcă istoricul' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tipărește' })).toBeVisible();
    await shot(page, 'staff-history', name());
    // The owner sees the total and the CSV.
    const context = await browser.newContext({ viewport: page.viewportSize()!, locale: 'ro-RO', timezoneId: 'Europe/Berlin' });
    await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    const owner = await context.newPage();
    await signIn(owner, shop, PASSWORD);
    await expect(owner).toHaveURL(/\/s\/panou$/);
    await owner.goto('/s/istoric');
    await expect(owner.getByText(/^1 reparație · .+ încasat$/)).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Descarcă istoricul' })).toBeVisible();
    await context.close();
  });
});
