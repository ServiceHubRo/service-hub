import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  cardAction,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  rpcAs,
  serviceRest,
  shot,
  signIn,
  userIdOf,
} from './support';

// T50 — the complete quote, the intake sheet and the client's company: the owner sets the hourly
// rate and the quote numbers; the shop writes the intake sheet on the drawing and the client
// confirms it; the quote editor (its own screen) adds labor and parts with VAT; the client reads
// them by section. The PDFs come from the Edge Function (job-document), checked by unit tests.

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
const shopCard = (page: Page, ref: string) => page.locator('main ul[aria-label] > li').filter({ hasText: ref });
const clientCard = (page: Page, ref: string) => page.locator('main section li').filter({ hasText: ref });

interface Day {
  date: string;
  bookable: boolean;
}
interface Slot {
  time: string;
  available: boolean;
}

async function freeSlot(email: string, shopId: string): Promise<{ date: string; slot: string }> {
  const av = await rpcAs<{ days: Day[] }>(email, 'get_availability', { p_shop_id: shopId, p_days: 30 });
  for (const day of av.days.filter((d) => d.bookable)) {
    const s = await rpcAs<{ slots: Slot[] }>(email, 'get_availability', { p_shop_id: shopId, p_from: day.date, p_days: 1, p_slots_for: day.date });
    const free = s.slots.find((x) => x.available);
    if (free) return { date: day.date, slot: free.time };
  }
  throw new Error('no free slot');
}

async function signedIn(browser: Browser, page: Page, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    localStorage.setItem('sh_lang', 'ro');
    localStorage.setItem('sh_onboarding_off', '1');
  });
  const p = await context.newPage();
  await signIn(p, email, PASSWORD);
  await expect(p).toHaveURL(/\/c\//);
  return p;
}

test.describe('the complete quote and the intake sheet', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('settings, intake confirmed by the client, a quote with labor and parts and VAT', async ({ page, browser }) => {
    const shopName = `Atelier T50 ${Date.now() % 100000}${Math.floor(Math.random() * 100)}`;
    const { email: shop, shopId } = await createBookableShop(shopName, ['frane']);
    await serviceRest(`shop_billing?shop_id=eq.${shopId}`, 'PATCH', {
      legal_name: 'AUTO T50 SRL',
      vat_id: 'RO14872301',
      vat_payer: true,
      legal_address: 'Str. Lungă 1, Brașov',
    });
    const client = await createUser('client');
    const at = await freeSlot(client, shopId);
    const booking = await rpcAs<{ id: string; ref: string }>(client, 'create_booking', {
      p_shop_id: shopId,
      p_service_id: 'frane',
      p_date: at.date,
      p_slot: at.slot,
      p_request_id: rid(),
      p_car: { make: 'Land Rover', model: 'Defender', year: 2023, plate: `BV ${10 + Math.floor(Math.random() * 89)} TST` },
      p_save_car: false,
    });
    await rpcAs(shop, 'confirm_booking', { p_booking_id: booking.id, p_request_id: rid() });

    // Setări → Devize: the hourly rate (with VAT), the next number, the terms.
    await signIn(page, shop, PASSWORD);
    await expect(page).toHaveURL(/\/s\//);
    await page.goto('/s/cont/setari');
    await page.getByRole('link', { name: /Devize/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Devize' })).toBeVisible();
    await expect(page.getByText('Plătitor de TVA: da, 21%.')).toBeVisible();
    await page.getByLabel('Tarif orar, lei cu TVA').fill('181,50');
    await page.getByLabel('Numărul următorului deviz').fill('477');
    await page.getByLabel('Mențiuni pe deviz').fill('Autovehiculul se ridică după confirmarea plății.');
    await expectNoHorizontalScroll(page);
    await shot(page, 't50-settings', name());
    await page.getByRole('button', { name: 'Salvează' }).click();
    await expect(page.getByRole('button', { name: 'Salvat' })).toBeVisible();
    const [saved] = await serviceRest<{ labor_rate: number; quote_terms: string }[]>(`shops?id=eq.${shopId}&select=labor_rate,quote_terms`, 'GET');
    expect(saved).toEqual({ labor_rate: 181.5, quote_terms: 'Autovehiculul se ridică după confirmarea plății.' });

    // The intake sheet: odometer, fuel, two marks on the drawing, a note, the options.
    await page.goto('/s/programari?tab=programate');
    const card = shopCard(page, booking.ref);
    await card.getByRole('link', { name: 'Completează fișa de preluare' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Fișa de preluare' })).toBeVisible();
    await page.getByLabel('Km la intrare').fill('23611');
    await page.getByRole('button', { name: '1/2' }).click();
    const drawing = page.getByRole('button', { name: 'Desenul mașinii. Atinge pentru a marca un defect.' });
    await drawing.scrollIntoViewIfNeeded();
    await drawing.click({ position: { x: 60, y: 230 } });
    await expect(page.getByLabel('Defectul 1', { exact: true })).toBeFocused();
    await page.getByLabel('Locul sau detalii').first().fill('Ușa stânga spate');
    await drawing.click({ position: { x: 125, y: 50 } });
    await page.getByLabel('Defectul 2', { exact: true }).selectOption({ label: 'Lovitură' });
    await page.getByLabel('Obiecte personale').fill('Scaun copil');
    await page.getByRole('group', { name: 'Clientul păstrează piesele înlocuite' }).getByRole('button', { name: 'Da' }).click();
    await page.getByRole('group', { name: 'Acord pentru proba de drum' }).getByRole('button', { name: 'Da' }).click();
    await expectNoHorizontalScroll(page);
    await shot(page, 't50-intake', name());
    await page.getByRole('button', { name: 'Trimite clientului' }).click();
    await expect(page.getByText(`Fișa de preluare pentru ${booking.ref} a fost trimisă clientului.`)).toBeVisible();
    await expect(card).toContainText('Fișa de preluare: trimisă clientului.');
    const [intake] = await serviceRest<{ odometer: number; fuel: number; damages: { kind: string }[] }[]>(
      `vehicle_intakes?booking_id=eq.${booking.id}&select=odometer,fuel,damages`,
      'GET',
    );
    expect(intake!.odometer).toBe(23611);
    expect(intake!.fuel).toBe(2);
    expect(intake!.damages.map((d) => d.kind)).toEqual(['scratch', 'dent']);

    // The client: the prompt on the card, the sheet, the confirmation.
    const clientPage = await signedIn(browser, page, client);
    await clientPage.goto('/c/programari');
    const cc = clientCard(clientPage, booking.ref);
    await cc.getByRole('link', { name: /Fișa de preluare/ }).click();
    await expect(clientPage.getByRole('heading', { level: 1, name: 'Fișa de preluare' })).toBeVisible();
    await expect(clientPage.getByText('Ușa stânga spate')).toBeVisible();
    await expect(clientPage.getByText('23.611 km')).toBeVisible();
    await expectNoHorizontalScroll(clientPage);
    await shot(clientPage, 't50-client-intake', name());
    await clientPage.getByRole('button', { name: 'Confirm fișa de preluare' }).click();
    await expect(clientPage.getByText(/Ai confirmat fișa:/)).toBeVisible();
    await expect(card).toContainText('Fișa de preluare: confirmată de client.');

    // The quote editor: the hourly rate filled in, parts with quantity, VAT; prices without VAT.
    await rpcAs(shop, 'start_inspection', { p_booking_id: booking.id, p_request_id: rid() });
    await page.goto('/s/programari?tab=programate');
    await (await cardAction(card, 'Trimite deviz')).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Deviz nou' })).toBeVisible();
    await expect(page.getByLabel('Tarif / oră, lei')).toHaveValue('181,50');
    await page.getByLabel('Operație').fill('Revizie ulei + filtre');
    await page.getByLabel('Ore', { exact: true }).fill('1,5');
    await page.getByLabel('Piesă sau material').fill('Ulei motor 0W-30 1L');
    await page.getByLabel('Producător', { exact: true }).fill('Petronas');
    await page.getByLabel('Cantitate').fill('4');
    await page.getByLabel('Preț unitar, lei').fill('129');
    await expect(page.getByText('788,25 lei').last()).toBeVisible();
    await expect(page.getByText('TVA 21%')).toBeVisible();
    await page.getByRole('button', { name: 'Fără TVA' }).click();
    await expect(page.getByLabel('Tarif / oră, lei')).toHaveValue('150');
    await expect(page.getByText('788,25 lei').last()).toBeVisible();
    await page.getByLabel('Termen de execuție').selectOption({ label: '2 ore' });
    await expectNoHorizontalScroll(page);
    await shot(page, 't50-editor', name());
    await page.getByRole('button', { name: 'Trimite devizul' }).click();
    await expect(page.getByText(`Devizul pentru ${booking.ref} a fost trimis clientului.`)).toBeVisible();
    await expect(card).toContainText('1,5 h × 181,50 lei');
    await expect(card).toContainText('Include TVA 21%: 136,80 lei.');
    const [quote] = await serviceRest<{ vat_rate: number; est_hours: number; total_sent: number }[]>(
      `quotes?booking_id=eq.${booking.id}&select=vat_rate,est_hours,total_sent`,
      'GET',
    );
    expect(quote).toEqual({ vat_rate: 21, est_hours: 2, total_sent: 788.25 });
    const [numbered] = await serviceRest<{ quote_number: number }[]>(`bookings?id=eq.${booking.id}&select=quote_number`, 'GET');
    expect(numbered!.quote_number).toBe(477);

    // The client reads it by section.
    await clientPage.goto('/c/programari');
    await expect(cc).toContainText('Manoperă');
    await expect(cc).toContainText('Piese și materiale');
    await expect(cc).toContainText('4 × 129 lei · Petronas');
    await expect(cc).toContainText('Termen de execuție: 2 ore.');
    await expectNoHorizontalScroll(clientPage);
    await shot(clientPage, 't50-client-quote', name());
    await clientPage.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    await expect(cc).toContainText('Parts and materials');
    await expect(cc).toContainText('Estimated time: 2 hours.');
    await shot(clientPage, 't50-client-quote-en', name());
    await page.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    await (await cardAction(card, 'Edit quote')).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Edit quote' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't50-editor-en', name());
    await clientPage.context().close();
  });

  test('the client chooses who quotes are issued to: a person or a company', async ({ page }) => {
    const client = await createUser('client');
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\//);
    await page.goto('/c/cont');
    await page.getByRole('link', { name: /Date pentru deviz/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Date pentru deviz' })).toBeVisible();
    // A person: the account's name, an optional address.
    await expect(page.getByRole('button', { name: 'Persoană fizică' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Devizele se emit pe numele Maria Pop, cu telefonul din cont.')).toBeVisible();
    await page.getByLabel('Adresa (opțional)').fill('Str. Mică 3, Brașov');
    await shot(page, 't50-person', name());
    await page.getByRole('button', { name: 'Salvează' }).click();
    await expect(page.getByRole('button', { name: 'Salvat' })).toBeVisible();
    // A company: the name is required, the codes optional but valid.
    await page.getByRole('button', { name: 'Persoană juridică' }).click();
    await page.getByLabel('CUI (opțional)').fill('123');
    await page.getByRole('button', { name: 'Salvează' }).click();
    await expect(page.getByText('Scrie denumirea firmei.')).toBeVisible();
    await page.getByLabel('Denumirea firmei').fill('Exemplu Consult SRL');
    await page.getByRole('button', { name: 'Salvează' }).click();
    await expect(page.getByText('CUI-ul nu este valid.')).toBeVisible();
    await page.getByLabel('CUI (opțional)').fill('');
    await page.getByLabel('Nr. Reg. Com. (opțional)').fill('J08/1249/2013');
    await expectNoHorizontalScroll(page);
    await shot(page, 't50-company', name());
    await page.getByRole('button', { name: 'Salvează' }).click();
    await expect(page.getByRole('button', { name: 'Salvat' })).toBeVisible();
    const id = await userIdOf(client);
    const [profile] = await serviceRest<Record<string, string | null>[]>(
      `profiles?id=eq.${id}&select=doc_party,person_address,company_name,company_vat_id,company_reg_com`,
      'GET',
    );
    expect(profile).toEqual({
      doc_party: 'company',
      person_address: 'Str. Mică 3, Brașov',
      company_name: 'Exemplu Consult SRL',
      company_vat_id: null,
      company_reg_com: 'J08/1249/2013',
    });
    await page.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Details for quotes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Company' })).toHaveAttribute('aria-pressed', 'true');
    await shot(page, 't50-company-en', name());
  });
});
