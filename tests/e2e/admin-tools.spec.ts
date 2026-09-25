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
} from './support';

// T16b — the admin's platform tools: subscriptions and payments, history reports, the catalog,
// platform settings and push texts, notices (seen by the client they were meant for), exports.

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
  await expect(page.getByRole('heading', { level: 1, name: 'Prezentare' })).toBeVisible();
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
  return { file: download.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8') };
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
    await page.getByLabel('Oraș (opțional)').fill(city);
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
    await expect(page.getByText(`Anunțul „${title}” e trimis.`)).toBeVisible();
    await expect(page.getByText(title).first()).toBeVisible();
    await expect(page.getByText(`Clienții din ${city}`).first()).toBeVisible();

    // The client who booked there sees it on Caută, marks it read, and it stays gone.
    const clientPage = await (await browser.newContext()).newPage();
    await clientPage.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    await signIn(clientPage, client, PASSWORD);
    const notice = clientPage.getByRole('region', { name: 'Anunț Service-Hub' }).filter({ hasText: title });
    await expect(notice).toBeVisible();
    await shot(clientPage, 't16b-notice-client', name());
    await notice.getByRole('button', { name: 'Am citit' }).click();
    await expect(notice).toHaveCount(0);
    await expect
      .poll(async () => (await serviceRest<unknown[]>(`notice_reads?user_id=eq.${await userIdOf(client)}`, 'GET')).length)
      .toBeGreaterThan(0);
    await clientPage.reload();
    await expect(clientPage.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();
    await expect(clientPage.getByRole('region', { name: 'Anunț Service-Hub' }).filter({ hasText: title })).toHaveCount(0);

    // A client who never booked in that city never sees it.
    const otherPage = await (await browser.newContext()).newPage();
    await otherPage.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    await signIn(otherPage, other, PASSWORD);
    await expect(otherPage.getByRole('heading', { level: 1, name: 'Caută' })).toBeVisible();
    await expect(otherPage.getByRole('region', { name: 'Anunț Service-Hub' }).filter({ hasText: title })).toHaveCount(0);

    // Withdrawn by the admin: gone, and in the audit log.
    await page.getByRole('listitem').filter({ hasText: title }).getByRole('button', { name: 'Retrage anunțul' }).click();
    await page.getByRole('listitem').filter({ hasText: title }).getByRole('button', { name: 'Retrage anunțul' }).last().click();
    await expect(page.getByText('Anunțul e retras.')).toBeVisible();
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
    await expect(page.getByText('Categoria e adăugată la sfârșitul listei.')).toBeVisible();

    await page.getByLabel('Caută serviciu sau categorie').fill(`Tractoare ${t}`);
    const card = page.getByRole('listitem').filter({ hasText: `cat_tractoare_${t}` });
    await card.getByRole('button', { name: new RegExp(`^Serviciu nou în Tractoare ${t}`) }).click();
    await card.getByLabel('Nume în română').fill(`Revizie tractor ${t}`);
    await card.getByLabel('Nume în engleză').fill(`Tractor service ${t}`);
    await expect(card.getByLabel('Cod serviciu')).toHaveValue(`revizie_tractor_${t}`);
    await card.getByLabel('Iconiță').selectOption('Truck');
    await card.getByRole('button', { name: 'Adaugă serviciul' }).click();
    await expect(page.getByText('Serviciul e adăugat la sfârșitul categoriei.')).toBeVisible();
    await expect(card.getByText(`revizie_tractor_${t}`)).toBeVisible();
    await shot(page, 't16b-catalog-new', name());

    // Renamed: the id stays.
    await card.getByRole('button', { name: `Editează: Revizie tractor ${t}` }).click();
    await card.getByLabel('Nume în română').fill(`Revizie completă tractor ${t}`);
    await card.getByRole('button', { name: 'Salvează' }).click();
    await expect(card.getByText(`Revizie completă tractor ${t}`)).toBeVisible();
    await expect(card.getByText(`revizie_tractor_${t}`)).toBeVisible();

    // The category switched off takes its service with it (so other tests never see it).
    await card.getByRole('button', { name: `Editează: Tractoare ${t}` }).click();
    await card.getByText('Categoria e activă').click();
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
    await expect(page.getByText(`Raportul ${r!.code} e anulat.`)).toBeVisible();
    await expect(card.getByText('Emis pentru altă mașină')).toBeVisible();
    const check = await rpcAs<{ void: boolean }>(client, 'verify_report', { p_code: r!.code });
    expect(check.void).toBe(true);
  });

  test('subscriptions: search, a founder price by hand, CSV exports', async ({ page }) => {
    const shopName = `Atelier Abonament ${tag()}`;
    await createBookableShop(shopName, ['ulei']);
    await signInAdmin(page);
    await openTool(page, 'Abonamente și plăți');
    await page.getByLabel('Caută service, oraș, cont, email, Stripe').fill(shopName);
    await expect(page.getByRole('link', { name: new RegExp(shopName) })).toBeVisible();
    await expect(page.getByText('Gratuit până pe', { exact: false }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, 't16b-subscriptions', name());

    const csv = await downloadCsv(page, page.getByRole('button', { name: 'Descarcă CSV' }));
    expect(csv.file).toMatch(/^abonamente-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.text).toContain('Cont;Service;Oraș');
    expect(csv.text).toContain(shopName);
    expect(csv.text.trim().split('\r\n')).toHaveLength(2);

    await page.getByRole('tab', { name: /Plăți/ }).click();
    await page.getByRole('tab', { name: /Abonamente/ }).click();
    await page.getByRole('link', { name: new RegExp(shopName) }).click();
    await page.getByRole('button', { name: 'Schimbă prețul' }).click();
    await page.getByLabel('Preț pe lună (lei)').fill('79,50');
    await page.getByRole('button', { name: 'Salvează' }).click();
    await expect(page.getByText('Prețul abonamentului e schimbat.')).toBeVisible();
    await expect(page.getByText('79,50 lei').first()).toBeVisible();

    // The shops list exports what it shows.
    await page.goto(`/admin/service-uri?q=${encodeURIComponent(shopName)}`);
    const shops = await downloadCsv(page, page.getByRole('button', { name: 'Descarcă CSV' }));
    expect(shops.text.trim().split('\r\n')).toHaveLength(2);
    expect(shops.text).toContain('79,5');

    // The export screen and the log.
    await openTool(page, 'Export');
    await shot(page, 't16b-export', name());
    await openAccount(page);
    await page.getByRole('link', { name: /^Jurnal de audit/ }).click();
    await expect(page.getByText('Export CSV').first()).toBeVisible();
    await expect(page.getByText('Preț abonament schimbat').first()).toBeVisible();
  });

  test('the tools in English', async ({ page }) => {
    await signInAdmin(page);
    await page.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    for (const tile of ['Subscriptions and payments', 'Service catalog', 'Platform settings', 'Notices', 'History reports', 'Export']) {
      await page.getByRole('link', { name: 'Account', exact: true }).filter({ visible: true }).first().click();
      await page.getByRole('link', { name: new RegExp(`^${tile}`) }).click();
      await expect(page.getByRole('heading', { level: 1, name: tile })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await shot(page, `t16b-en-${tile.split(' ')[0]!.toLowerCase()}`, name());
    }
  });
});
