import { expect, test, type Page } from '@playwright/test';
import {
  BACKEND,
  SEED,
  SEED_PASSWORD,
  PASSWORD,
  createBookableShop,
  createUser,
  expectNoHorizontalScroll,
  openAccount,
  rpcAs,
  serviceRest,
  shot,
  signIn,
  userIdOf,
  xlsxText,
  pickFilter,
} from './support';

// T16b — the admin's platform tools: subscriptions and payments, history reports, the catalog,
// platform settings and push texts, notices (seen by the client they were meant for), exports.

const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const name = () => test.info().project.name;
const rid = () => crypto.randomUUID();
const tag = () => `${Date.now() % 1_000_000}${Math.floor(Math.random() * 100)}`;

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
  // The demo admin is shared by tests running in parallel: its saved language never changes.
  await page.route('**/rest/v1/profiles?*', (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue(),
  );
});

async function signInAdmin(page: Page) {
  await signIn(page, SEED.admin, SEED_PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Panou principal' })).toBeVisible();
}

async function openTool(page: Page, label: string) {
  await openAccount(page);
  await page.getByRole('link', { name: new RegExp(`^${label}`) }).click();
  await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible();
}

/** A free (date, time) of a shop, as a client sees it. */
async function freeSlot(client: string, shopId: string): Promise<{ date: string; slot: string }> {
  const av = await rpcAs<{ days: { date: string; bookable: boolean }[] }>(client, 'get_availability', { p_shop_id: shopId, p_days: 30 });
  for (const day of av.days.filter((d) => d.bookable)) {
    const s = await rpcAs<{ slots: { time: string; available: boolean }[] }>(client, 'get_availability', {
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

async function downloadCsv(page: Page, button: ReturnType<Page['getByRole']>): Promise<{ file: string; text: string }> {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const chunks = await (await download.createReadStream()).toArray();
  return { file: download.suggestedFilename(), text: xlsxText(new Uint8Array(Buffer.concat(chunks))) };
}

test.describe('admin tools', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(150_000);

  test('a notice to the clients of one city reaches only them, with a preview first', async ({ page, browser }) => {
    const city = `Orasul${tag()}`;
    const { shopId } = await createBookableShop(`Atelier Anunt ${tag()}`, ['ulei'], {}, { city });
    const client = await createUser('client');
    const other = await createUser('client');
    const at = await freeSlot(client, shopId);
    await rpcAs(client, 'create_booking', {
      p_shop_id: shopId,
      p_service_id: 'ulei',
      p_date: at.date,
      p_slot: at.slot,
      p_request_id: rid(),
      p_car: { make: 'Dacia', model: 'Logan', year: 2019, plate: 'BV 44 KLM' },
      p_save_car: false,
    });

    await signInAdmin(page);
    await openTool(page, 'Anunțuri');
    await page.getByRole('button', { name: 'Toți clienții' }).click();
    // The city is picked from the cities that have shops.
    await page.getByRole('combobox', { name: 'Oraș' }).selectOption(city);
    const title = `Program de sărbători ${tag()}`;
    // Nothing written yet: the preview asks for the text first.
    await page.getByRole('button', { name: 'Previzualizează' }).click();
    await expect(page.getByText('Scrie titlul și textul în română.').first()).toBeVisible();
    await page.getByLabel('Titlu în română').fill(title);
    await page.getByLabel('Text în română').fill('Pe 1 decembrie service-urile sunt închise.');
    await page.getByRole('button', { name: 'Previzualizează' }).click();
    await expect(page.getByText(`Clienții din ${city}: 1 persoană`)).toBeVisible();
    // Both languages, the English falling back to the Romanian text.
    await expect(page.getByRole('region', { name: 'Anunț Service-Hub' })).toHaveCount(2);
    await expectNoHorizontalScroll(page);
    await shot(page, 't16b-notice-preview', name());
    await page.getByRole('button', { name: 'Trimite către 1 persoană' }).click();
    await expect(page.getByText(`Anunțul „${title}” este trimis.`)).toBeVisible();
    await expect(page.getByText(title).first()).toBeVisible();
    await expect(page.getByText(`Clienții din ${city}`).first()).toBeVisible();

    // The client who booked there finds it in Mesaje (T20a), counted on the tab, new until opened.
    const clientPage = await (await browser.newContext()).newPage();
    await clientPage.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    await signIn(clientPage, client, PASSWORD);
    await expect(clientPage.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();
    const notice = clientPage.getByRole('region', { name: 'Anunț Service-Hub' }).filter({ hasText: title });
    await expect(notice).toHaveCount(0);
    const messagesTab = clientPage.getByRole('link', { name: /^Mesaje/ }).filter({ visible: true }).first();
    await expect(messagesTab).toHaveAccessibleName(/(noutate|noutăți) necitit/);
    await messagesTab.click();
    await expect(clientPage.getByRole('heading', { level: 1, name: 'Mesaje' })).toBeVisible();
    await expect(notice).toBeVisible();
    await expect(notice.getByText('Nou', { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(clientPage);
    await shot(clientPage, 't20a-notice-messages', name());
    const head = notice.getByRole('button');
    await expect(head).toHaveAttribute('aria-expanded', 'false');
    await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    await expect(notice.getByText('Pe 1 decembrie service-urile sunt închise.')).toBeVisible();
    await expect(notice.getByText('Nou', { exact: true })).toHaveCount(0);
    await shot(clientPage, 't20a-notice-open', name());
    await expect
      .poll(async () => (await serviceRest<unknown[]>(`notice_reads?user_id=eq.${await userIdOf(client)}`, 'GET')).length)
      .toBeGreaterThan(0);
    // Read stays read, and the notice stays in Mesaje for its 30 days.
    await clientPage.reload();
    await expect(notice).toBeVisible();
    await expect(notice.getByText('Nou', { exact: true })).toHaveCount(0);

    // A client who never booked in that city never sees it.
    const otherPage = await (await browser.newContext()).newPage();
    await otherPage.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    await signIn(otherPage, other, PASSWORD);
    await expect(otherPage.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();
    await otherPage.goto('/c/mesaje');
    await expect(otherPage.getByRole('heading', { level: 1, name: 'Mesaje' })).toBeVisible();
    await expect(otherPage.getByRole('region', { name: 'Anunț Service-Hub' }).filter({ hasText: title })).toHaveCount(0);

    // Withdrawn by the admin: gone, and in the audit log.
    await page.getByRole('listitem').filter({ hasText: title }).getByRole('button', { name: 'Retrage anunțul' }).click();
    await page.getByRole('listitem').filter({ hasText: title }).getByRole('button', { name: 'Retrage anunțul' }).last().click();
    await expect(page.getByText('Anunțul este retras.')).toBeVisible();
    await openAccount(page);
    await page.getByRole('link', { name: /^Jurnal de audit/ }).click();
    await expect(page.getByText('Anunț trimis').first()).toBeVisible();
    await expect(page.getByText('Anunț retras').first()).toBeVisible();
  });

  test('catalog: a new category and service, renamed, switched off, logged', async ({ page }) => {
    const t = tag();
    await signInAdmin(page);
    await openTool(page, 'Catalog de servicii');
    await expect(page.getByText('Revizii & Întreținere')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't16b-catalog', name());

    await page.getByRole('button', { name: 'Categorie nouă' }).click();
    await page.getByLabel('Nume în română').fill(`Tractoare ${t}`);
    await page.getByLabel('Nume în engleză').fill(`Tractors ${t}`);
    await expect(page.getByLabel('Cod categorie')).toHaveValue(`cat_tractoare_${t}`);
    await page.getByRole('button', { name: 'Adaugă categoria' }).click();
    await expect(page.getByText('Categoria este adăugată la sfârșitul listei.')).toBeVisible();

    await page.getByLabel('Caută serviciu sau categorie').fill(`Tractoare ${t}`);
    const card = page.getByRole('listitem').filter({ hasText: `Tractoare ${t}` });
    await card.getByRole('button', { name: new RegExp(`^Serviciu nou în Tractoare ${t}`) }).click();
    await card.getByLabel('Nume în română').fill(`Revizie tractor ${t}`);
    await card.getByLabel('Nume în engleză').fill(`Tractor service ${t}`);
    await expect(card.getByLabel('Cod serviciu')).toHaveValue(`revizie_tractor_${t}`);
    await card.getByLabel('Iconiță').selectOption('Truck');
    // The service reminder interval (T19d): whole months, 1–120, or empty.
    await card.getByLabel('Reminder de revizie (luni)').fill('0');
    await expect(card.getByText('Scrie un număr întreg de luni, între 1 și 120, sau lasă câmpul gol.')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Adaugă serviciul' })).toBeDisabled();
    await card.getByLabel('Reminder de revizie (luni)').fill('18');
    await card.getByRole('button', { name: 'Adaugă serviciul' }).click();
    await expect(page.getByText('Serviciul este adăugat la sfârșitul categoriei.')).toBeVisible();
    await expect(card.getByText(`Revizie tractor ${t}`, { exact: true })).toBeVisible();
    await expect(card.getByText('Reminder: la 18 luni')).toBeVisible();
    await shot(page, 't16b-catalog-new', name());

    // Renamed: the id stays.
    await card.getByRole('button', { name: `Editează: Revizie tractor ${t}` }).click();
    await expect(card.getByLabel('Reminder de revizie (luni)')).toHaveValue('18');
    await shot(page, 't19d-catalog-reminder', name());
    await card.getByLabel('Nume în română').fill(`Revizie completă tractor ${t}`);
    await card.getByLabel('Reminder de revizie (luni)').fill('');
    await card.getByRole('button', { name: 'Salvează' }).click();
    await expect(card.getByText(`Revizie completă tractor ${t}`)).toBeVisible();
    await expect(card.getByText(/^Reminder:/)).toHaveCount(0);
    // The list shows the name in the screen's language only; the code stays.
    const [renamed] = await serviceRest<{ name_ro: string }[]>(`services?id=eq.revizie_tractor_${t}&select=name_ro`, 'GET');
    expect(renamed!.name_ro).toBe(`Revizie completă tractor ${t}`);
    await expect(card.getByText(`Tractor service ${t}`)).toHaveCount(0);

    // The category switched off takes its service with it (so other tests never see it).
    await card.getByRole('button', { name: `Editează: Tractoare ${t}` }).click();
    await card.getByText('Categoria este activă').click();
    await expect(card.getByText('Oprind categoria se opresc și toate serviciile din ea.', { exact: false })).toBeVisible();
    await card.getByRole('button', { name: 'Salvează' }).click();
    await expect(card.getByText('Oprit')).toHaveCount(2);
    const [svc] = await serviceRest<{ enabled: boolean }[]>(`services?id=eq.revizie_tractor_${t}&select=enabled`, 'GET');
    expect(svc!.enabled).toBe(false);

    await openAccount(page);
    await page.getByRole('link', { name: /^Jurnal de audit/ }).click();
    await expect(page.getByText('Serviciu adăugat').first()).toBeVisible();
    await expect(page.getByText('Categorie modificată').first()).toBeVisible();
  });

  test('settings and push texts', async ({ page }) => {
    await signInAdmin(page);
    await openTool(page, 'Setări platformă');
    await expect(page.getByLabel('Zile pentru răspuns la deviz')).toHaveValue(/^\d+$/);
    await expectNoHorizontalScroll(page);
    await shot(page, 't16b-settings', name());

    // Nothing changed; a value that is not a number is marked.
    await page.getByRole('button', { name: 'Salvează setările' }).click();
    await expect(page.getByText('Nu ai schimbat nimic.')).toBeVisible();
    await page.getByLabel('Zile gratuite').fill('nouăzeci');
    await page.getByRole('button', { name: 'Salvează setările' }).click();
    await expect(page.getByText('Verifică câmpurile marcate.')).toBeVisible();
    await page.getByLabel('Zile gratuite').fill('90');

    if (name() === 'desktop-1440') {
      // Only one project changes a real value (the VAT rate is not used before T14b), then puts it back.
      await page.getByLabel('Cota TVA (%)').fill('19');
      await page.getByRole('button', { name: 'Salvează setările' }).click();
      await expect(page.getByText('Setările sunt salvate.')).toBeVisible();
      await page.getByLabel('Cota TVA (%)').fill('0');
      await page.getByRole('button', { name: 'Salvează setările' }).click();
      await expect(page.getByText('Setările sunt salvate.')).toBeVisible();
    }

    await page.getByRole('link', { name: /^Textele notificărilor/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Textele notificărilor' })).toBeVisible();
    await page.getByLabel('Caută în texte').fill('shop.new_review');
    const row = page.getByRole('listitem').filter({ hasText: 'shop.new_review' });
    await row.getByRole('button', { name: 'Editează textul: shop.new_review' }).click();
    await row.getByLabel('Text în română').fill('{client} a lăsat {rating} stele și {nume}');
    await expect(row.getByText('Aceste cuvinte nu se completează la această notificare: {nume}.', { exact: false })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Salvează' })).toBeDisabled();
    await shot(page, 't16b-texts', name());
    await row.getByRole('button', { name: 'Renunță' }).click();
  });

  test('history reports: void one issued in error', async ({ page }) => {
    const client = await createUser('client');
    const clientId = await userIdOf(client);
    const [r] = await serviceRest<{ id: string; code: string }[]>('history_reports', 'POST', {
      client_id: clientId,
      car_snapshot: { make: 'Dacia', model: 'Logan', plate: 'BV 44 KLM' },
      job_count: 2,
      price: 29,
      amount_paid: 29,
      status: 'generated',
      paid_at: new Date().toISOString(),
      generated_at: new Date().toISOString(),
    });
    await signInAdmin(page);
    await openTool(page, 'Rapoarte de istoric');
    await page.getByLabel('Caută cod, număr, mașină, client').fill(r!.code);
    const card = page.getByRole('listitem').filter({ hasText: r!.code });
    await expect(card.getByText('Gata')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't16b-reports', name());
    await card.getByRole('button', { name: 'Anulează raportul' }).click();
    await card.getByRole('button', { name: 'Anulează raportul' }).last().click();
    await expect(card.getByText('Scrie motivul.', { exact: false }).or(card.getByRole('alert'))).toBeVisible();
    await card.getByLabel('Motiv').fill('Emis pentru altă mașină');
    await card.getByRole('button', { name: 'Anulează raportul' }).last().click();
    await expect(page.getByText(`Raportul ${r!.code} este anulat.`)).toBeVisible();
    await expect(card.getByText('Emis pentru altă mașină')).toBeVisible();
    const check = await rpcAs<{ void: boolean }>(client, 'verify_report', { p_code: r!.code });
    expect(check.void).toBe(true);
  });

  test('subscriptions: search, a founder price by hand, CSV exports', async ({ page }) => {
    const shopName = `Atelier Abonament ${tag()}`;
    const { shopId } = await createBookableShop(shopName, ['ulei']);
    await signInAdmin(page);
    await openTool(page, 'Abonamente și plăți');
    await page.getByLabel('Caută service, oraș, cont, email, Stripe').fill(shopName);
    await expect(page.getByRole('link', { name: new RegExp(shopName) })).toBeVisible();
    await expect(page.getByText('Gratuit până pe', { exact: false }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't16b-subscriptions', name());

    const csv = await downloadCsv(page, page.getByRole('button', { name: 'Descarcă Excel' }));
    expect(csv.file).toMatch(/^abonamente-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(csv.text).toContain('Cont;Service;Oraș');
    expect(csv.text).toContain(shopName);
    expect(csv.text.trim().split('\r\n')).toHaveLength(2);

    await page.getByRole('tab', { name: /Plăți/ }).click();
    await page.getByRole('tab', { name: /Abonamente/ }).click();
    await page.getByRole('link', { name: new RegExp(shopName) }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/service-uri/${shopId}$`));
    await expect(page.getByRole('heading', { level: 1, name: shopName })).toBeVisible();
    await page.getByRole('button', { name: 'Schimbă prețul' }).click();
    await page.getByLabel('Preț pe lună (lei)').fill('79,50');
    await page.getByRole('button', { name: 'Salvează' }).click();
    await expect(page.getByText('Prețul abonamentului este schimbat.')).toBeVisible();
    await expect(page.getByText('79,50 lei').first()).toBeVisible();

    // The shops list exports what it shows.
    await page.goto(`/admin/service-uri?q=${encodeURIComponent(shopName)}`);
    const shops = await downloadCsv(page, page.getByRole('button', { name: 'Descarcă Excel' }));
    expect(shops.text.trim().split('\r\n')).toHaveLength(2);
    expect(shops.text).toContain('79.5');

    // The export screen and the log.
    await openTool(page, 'Export');
    await shot(page, 't16b-export', name());
    await openAccount(page);
    await page.getByRole('link', { name: /^Jurnal de audit/ }).click();
    await expect(page.getByText('Export Excel').first()).toBeVisible();
    await expect(page.getByText('Preț abonament schimbat').first()).toBeVisible();
  });

  test('the tools in English', async ({ page }) => {
    await signInAdmin(page);
    await page.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    for (const tile of ['Subscriptions and payments', 'Service catalog', 'Platform settings', 'Notices', 'History reports', 'Export']) {
      await page.getByRole('link', { name: 'Account', exact: true }).filter({ visible: true }).first().click();
      await page.getByRole('link', { name: new RegExp(`^${tile}`) }).click();
      await expect(page.getByRole('heading', { level: 1, name: tile })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await shot(page, `t16b-en-${tile.split(' ')[0]!.toLowerCase()}`, name());
    }
  });
});

test.describe('Raport ANAF', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test('every shop by category, a check from the list, the Excel file', async ({ page }) => {
    const id = tag();
    const unknownName = `Anaf Negasit ${id}`;
    const mismatchName = `Anaf Nume ${id}`;
    const { shopId: unknown } = await createBookableShop(unknownName, ['ulei']);
    const { shopId: mismatch } = await createBookableShop(mismatchName, ['ulei']);
    // A new CUI forgets ANAF's answer (trigger): the CUI first, then what ANAF said.
    await serviceRest(`shop_billing?shop_id=eq.${unknown}`, 'PATCH', { vat_id: '160796', legal_name: 'Negasit SRL' });
    await serviceRest(`shop_billing?shop_id=eq.${unknown}`, 'PATCH', {
      anaf_cui: '160796',
      anaf_status: 'not_found',
      anaf_checked_at: new Date().toISOString(),
    });
    await serviceRest(`shop_billing?shop_id=eq.${mismatch}`, 'PATCH', { vat_id: 'RO18000003', legal_name: 'Alt Nume SRL', vat_payer: false });

    await signInAdmin(page);
    await openTool(page, 'Raport ANAF');
    await page.getByLabel('Caută după service, cod, CUI sau denumire').fill(id);
    const unknownCard = page.locator('li').filter({ hasText: unknownName });
    const mismatchCard = page.locator('li').filter({ hasText: mismatchName });
    await expect(unknownCard).toContainText('Negăsită la ANAF');
    await expect(unknownCard).toContainText('160796');
    // (The daily batch of another test may have checked it already.)
    await expect(mismatchCard).toContainText(/Neverificată|Nume diferit/);
    await expectNoHorizontalScroll(page);
    await shot(page, 'anaf-report', name());

    // Checked from the list: ANAF knows the CUI under another name, as a VAT payer; the VAT tick follows ANAF.
    await mismatchCard.getByRole('button', { name: /^Verifică (la ANAF|din nou)$/ }).click();
    await expect(page.getByText(`Am verificat din nou ${mismatchName} la ANAF.`)).toBeVisible();
    await expect(mismatchCard).toContainText('Nume diferit');
    await expect(mismatchCard).toContainText('AUTO TEST S.R.L.');
    await expect(mismatchCard).not.toContainText('TVA diferit');
    await expect(mismatchCard.getByRole('button', { name: 'Verifică din nou' })).toBeVisible();

    // The chips.
    await pickFilter(page, /^Negăsită · \d+$/);
    await expect(unknownCard).toBeVisible();
    await expect(mismatchCard).toHaveCount(0);
    await pickFilter(page, /^Probleme · \d+$/);
    await expect(unknownCard).toBeVisible();
    await expect(mismatchCard).toBeVisible();
    await pickFilter(page, /^Firmă activă · \d+$/);
    await expect(page.getByText('Niciun rezultat pentru filtrele alese.')).toBeVisible();
    await pickFilter(page, /^Toate · \d+$/);

    // The Excel file holds what the screen shows.
    const file = await downloadCsv(page, page.getByRole('button', { name: 'Descarcă Excel' }));
    expect(file.file).toMatch(/^raport-anaf-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(file.text).toContain(unknownName);
    expect(file.text).toContain('AUTO TEST S.R.L.');
    expect(file.text).toContain('Negăsită la ANAF');

    // A card opens the shop.
    await unknownCard.getByRole('link', { name: unknownName }).click();
    await expect(page.getByRole('heading', { level: 1, name: unknownName })).toBeVisible();
  });

  test('a company ANAF does not confirm: the owner is told, 14 days later out of search, back on its own', async ({ page }) => {
    const shopName = `Anaf Termen ${tag()}`;
    const { email, shopId } = await createBookableShop(shopName, ['ulei']);
    const owner = await userIdOf(email);
    await serviceRest(`shop_billing?shop_id=eq.${shopId}`, 'PATCH', { vat_id: '160796', legal_name: 'Negasit SRL' });
    const [config] = await serviceRest<{ dispatch_token: string }[]>('push_config?id=eq.1&select=dispatch_token', 'GET');
    /** The daily run, as pg_cron starts it: the companies due, one request to ANAF, the deadlines. */
    const dailyRun = async () => {
      const res = await fetch(`${API}/functions/v1/verify-company`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dispatch-token': config!.dispatch_token },
        body: JSON.stringify({ batch: true }),
      });
      expect(res.status).toBe(200);
      return (await res.json()) as { due: number; recorded: number; hidden: number };
    };
    const billing = async () =>
      (
        await serviceRest<{ anaf_status: string | null; anaf_problem_since: string | null; anaf_hidden_at: string | null }[]>(
          `shop_billing?shop_id=eq.${shopId}&select=anaf_status,anaf_problem_since,anaf_hidden_at`,
          'GET',
        )
      )[0]!;
    const events = async (event: string) =>
      (await serviceRest<unknown[]>(`notification_events?user_id=eq.${owner}&event=eq.${event}&select=id`, 'GET')).length;

    // Without the token the run is refused.
    const refused = await fetch(`${API}/functions/v1/verify-company`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dispatch-token': 'wrong' },
      body: JSON.stringify({ batch: true }),
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);

    // ANAF does not know the CUI: the owner is told once and has 14 days.
    expect((await dailyRun()).recorded).toBeGreaterThan(0);
    await expect.poll(async () => (await billing()).anaf_status).toBe('not_found');
    expect((await billing()).anaf_problem_since).not.toBeNull();
    expect(await events('company_problem')).toBe(1);
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou/);
    const banner = page.getByText('Nu am găsit CUI-ul din Date de facturare în registrul ANAF. Poate e doar o greșeală de scriere.');
    await expect(banner).toBeVisible();
    await expect(page.getByText(/Te rugăm să verifici datele până pe .+, ca service-ul să rămână vizibil în căutări\./)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 'anaf-deadline-banner', name());

    // 15 days later, ANAF still does not know it: out of search, the owner is told.
    await serviceRest(`shop_billing?shop_id=eq.${shopId}`, 'PATCH', {
      anaf_problem_since: new Date(Date.now() - 15 * 86_400_000).toISOString(),
      anaf_checked_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    await dailyRun();
    await expect.poll(async () => (await billing()).anaf_hidden_at).not.toBeNull();
    expect(await events('company_problem')).toBe(1);
    expect(await events('company_hidden')).toBe(1);
    await page.reload();
    await expect(page.getByText('Nu am putut confirma încă firma la ANAF. Verifică CUI-ul în Date de facturare și service-ul revine automat.')).toBeVisible();
    await expect(banner).toHaveCount(0);
    await shot(page, 'anaf-hidden-banner', name());

    // The owner fixes the CUI: the next run confirms it and the shop is back.
    await serviceRest(`shop_billing?shop_id=eq.${shopId}`, 'PATCH', { vat_id: 'RO18000003', legal_name: 'Auto Test SRL' });
    await dailyRun();
    await expect.poll(async () => (await billing()).anaf_hidden_at).toBeNull();
    expect(await billing()).toMatchObject({ anaf_status: 'active', anaf_problem_since: null });
    expect(await events('company_ok')).toBe(1);
    await page.reload();
    await expect(page.getByText('Nu am putut confirma încă firma la ANAF.', { exact: false })).toHaveCount(0);
    await expect(banner).toHaveCount(0);
  });
});
