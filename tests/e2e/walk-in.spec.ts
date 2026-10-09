import { expect, test, type Page } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  createBookableShop,
  createUser,
  expectAccessible,
  expectNoHorizontalScroll,
  rpcAs,
  serviceRest,
  shot,
  signIn,
  uniquePhone,
  userIdOf,
  verifyPhoneByAdmin,
} from './support';

// T29 — a booking the shop adds for a client who called or walked in: the form, the card, the
// client's answer to the quote recorded by the shop, the SMS link and taking it into an account.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

const name = () => test.info().project.name;
const cards = (page: Page) => page.locator('main ul[aria-label] > li');

/** The first free day tile and the first free time under it. */
async function pickFirstFreeSlot(page: Page) {
  await page.getByRole('button', { name: /\d+ (de )?(loc|locuri)$/ }).and(page.locator(':enabled')).first().click();
  await page.getByRole('button', { name: /^\d{2}:\d{2}$/ }).and(page.locator(':enabled')).first().click();
}

test.describe('bookings added by the shop', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('the shop adds one, records the answer to the quote; the client takes it with the same phone', async ({ page, browser }) => {
    const shop = await createBookableShop('Atelier Telefon', ['ulei', 'frane']);
    const phone = uniquePhone();

    // ------------------------------------------------------------------ the form
    await signIn(page, shop.email, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await page.goto('/s/programari');
    await page.getByRole('link', { name: 'Adaugă programare' }).click();
    await expect(page).toHaveURL(/\/s\/programari\/nou$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Adaugă programare' })).toBeVisible();

    // Nothing filled in: the missing fields say so, nothing is sent.
    await page.getByRole('button', { name: 'Adaugă programarea' }).click();
    await expect(page.getByText('Completează câmpurile marcate.')).toBeVisible();
    await expect(page.getByText('Scrie numele clientului.')).toBeVisible();

    await page.getByLabel('Nume').fill('Dan Marin');
    await page.getByLabel('Telefon').fill(phone.national);
    await page.getByLabel('Marcă').fill('Opel');
    await page.getByLabel('Model').fill('Astra');
    await page.getByLabel('Nr. înmatriculare').fill('bv 07 dan');
    await page.getByRole('combobox', { name: 'Serviciu' }).selectOption('ulei');
    await pickFirstFreeSlot(page);
    await expect(page.getByRole('checkbox', { name: 'Trimite clientului programarea prin SMS' })).toBeChecked();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'add booking');
    await shot(page, 'walkin-form', name());

    await page.getByRole('button', { name: 'Adaugă programarea' }).click();
    await expect(page).toHaveURL(/\/s\/programari\?tab=programate$/);
    await expect(page.getByText(/a fost adăugată: .*Clientul primește un SMS\./)).toBeVisible();
    const card = cards(page).filter({ hasText: 'Dan Marin' });
    await expect(card).toContainText('Adăugată de service · SMS trimis');
    await expect(card).toContainText('BV 07 DAN');
    // "Adaugă programare" sits in the same place in both languages (under the title on a phone).
    await expectNoHorizontalScroll(page);
    await shot(page, 'walkin-list', name());

    const [booking] = await serviceRest<{ id: string; ref: string; invite_token: string; status: string }[]>(
      `bookings?client_phone=eq.${encodeURIComponent(phone.e164)}&select=id,ref,invite_token,status`,
      'GET',
    );
    expect(booking!.status).toBe('confirmed');
    const [invite] = await serviceRest<{ channels: string[] }[]>(
      `notification_events?event=eq.walk_in_invite&booking_id=eq.${booking!.id}&select=channels`,
      'GET',
    );
    expect(invite!.channels).toEqual(['sms']);

    // ------------------------------------------------------------------ the quote, answered at the shop
    await rpcAs(shop.email, 'start_inspection', { p_booking_id: booking!.id, p_request_id: crypto.randomUUID() });
    await rpcAs(shop.email, 'send_quote', {
      p_booking_id: booking!.id,
      p_items: [
        { name: 'Ulei 5W30', price: 250 },
        { name: 'Filtru aer', price: 90 },
      ],
      p_request_id: crypto.randomUUID(),
    });
    await expect(card).toContainText('Clientul nu are cont. Înregistrează aici răspunsul lui.');
    await card.getByRole('button', { name: 'Răspunsul clientului' }).click();
    await expect(card.getByText('Decizia clientului')).toBeVisible();
    await card.getByRole('checkbox', { name: /Filtru aer/ }).setChecked(false);
    await expectAccessible(page, 'client answer');
    await shot(page, 'walkin-answer', name());
    await card.getByRole('button', { name: 'Aprobat de client în service' }).click();
    await expect(card).toContainText('Aprobat de client în service: 1 din 2 poziții');
    await expect(card.getByRole('button', { name: 'În lucru' })).toBeVisible();

    // ------------------------------------------------------------------ the link in the SMS
    const visitor = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    await visitor.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    const v = await visitor.newPage();
    await v.goto(`/p/${booking!.invite_token}`);
    await expect(v.getByText('Atelier Telefon, Brașov')).toBeVisible();
    await expect(v.getByText('Opel Astra')).toBeVisible();
    await expect(v.getByText('Dan Marin')).toHaveCount(0);
    await expectNoHorizontalScroll(v);
    await expectAccessible(v, 'booking link');
    await shot(v, 'walkin-link', name());

    // A wrong link says so.
    await v.goto('/p/0000000000000000');
    await expect(v.getByText('Linkul nu mai este valabil.')).toBeVisible();

    // The client makes an account with the same phone (confirmed) and signs in from the link.
    const client = await createUser('client', { phone: phone.e164, name: 'Dan Marin' });
    await verifyPhoneByAdmin(client);
    await v.goto(`/p/${booking!.invite_token}`);
    await v.getByRole('link', { name: 'Am deja cont' }).click();
    await v.getByLabel('Email').fill(client);
    await v.getByLabel('Parolă', { exact: true }).fill(PASSWORD);
    await v.getByRole('button', { name: 'Intră în cont' }).click();
    await expect(v).toHaveURL(new RegExp(`/c/preia/${booking!.invite_token}$`));
    await expect(v.getByRole('heading', { level: 1, name: 'Adaugă programarea în cont' })).toBeVisible();
    await expectAccessible(v, 'claim');
    await shot(v, 'walkin-claim', name());
    await v.getByRole('button', { name: 'Adaug-o în contul meu' }).click();
    await expect(v).toHaveURL(/\/c\/programari$/);
    await expect(v.getByText('Atelier Telefon').first()).toBeVisible();
    // The car came into the garage.
    const cars = await serviceRest<{ plate: string }[]>(`cars?plate_norm=eq.BV07DAN&select=plate`, 'GET');
    expect(cars.length).toBeGreaterThan(0);
    await visitor.close();

    // The shop sees the client has it now, and a conversation is possible.
    await page.reload();
    await expect(card).toContainText('Adăugată de service · în contul clientului');
  });

  test('a client with another phone cannot take it; the form in English', async ({ page }) => {
    const shop = await createBookableShop('Atelier Strain', ['ulei']);
    const phone = uniquePhone();
    const days = await rpcAs<{ days: { date: string; bookable: boolean }[] }>(shop.email, 'get_availability', {
      p_shop_id: shop.shopId,
      p_days: 14,
    });
    const date = days.days.find((d) => d.bookable)!.date;
    const slots = await rpcAs<{ slots: { time: string; available: boolean }[] }>(shop.email, 'get_availability', {
      p_shop_id: shop.shopId,
      p_from: date,
      p_days: 1,
      p_slots_for: date,
    });
    const row = await rpcAs<{ id: string; invite_token: string }>(shop.email, 'shop_create_booking', {
      p_service_id: 'ulei',
      p_date: date,
      p_slot: slots.slots.find((s) => s.available)!.time,
      p_client_name: 'Ana Pop',
      p_client_phone: phone.national,
      p_car: { make: 'Skoda', model: 'Fabia', plate: 'BV 11 ANA' },
      p_request_id: crypto.randomUUID(),
      p_send_invite: false,
    });

    const other = await createUser('client');
    await verifyPhoneByAdmin(other);
    await signIn(page, other, PASSWORD);
    await expect(page).toHaveURL(/\/c\//);
    await page.goto(`/c/preia/${row.invite_token}`);
    await page.getByRole('button', { name: 'Adaug-o în contul meu' }).click();
    await expect(page.getByText('Programarea a fost făcută pe alt număr de telefon sau email.', { exact: false })).toBeVisible();
    const [b] = await serviceRest<{ client_id: string | null }[]>(`bookings?id=eq.${row.id}&select=client_id`, 'GET');
    expect(b!.client_id).toBeNull();

    // The shop's form in English.
    await page.context().clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('sh_lang', 'ro');
    });
    await signIn(page, shop.email, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await serviceRest(`profiles?id=eq.${await userIdOf(shop.email)}`, 'PATCH', { lang: 'en' });
    await page.goto('/s/programari/nou');
    await expect(page.getByRole('heading', { level: 1, name: 'Add a booking' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Text the booking to the client' })).toBeChecked();
    await expect(page.locator('main')).not.toContainText('Adaugă');
    await expectNoHorizontalScroll(page);
    await shot(page, 'walkin-form-en', name());
    await page.goto('/s/programari?tab=programate');
    await expect(cards(page).filter({ hasText: 'Ana Pop' })).toContainText('Added by the shop · no account');
    await shot(page, 'walkin-list-en', name());
  });
});
