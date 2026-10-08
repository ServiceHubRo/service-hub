import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  createBookableShop,
  createUser,
  expectAccessible,
  expectNoHorizontalScroll,
  serviceRest,
  rpcAs,
  shot,
  signIn,
  uniquePhone,
  userIdOf,
  verifyPhoneByAdmin,
} from './support';

// T31a — a shop imports its clients, cars and past jobs from another program: the file, the
// columns, what comes in, Istoric and Fișa mașinii, the phone filling "Adaugă programare", undo.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

const name = () => test.info().project.name;

test.describe('import from another program', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(120_000);

  test('the owner imports a CSV; the jobs show in Istoric; the phone fills a new booking; undo', async ({ page }) => {
    const shop = await createBookableShop('Atelier Import', ['ulei']);
    const ion = uniquePhone();
    const maria = uniquePhone();
    const tag = Array.from({ length: 3 }, () => 'ABCDEFGHJKLMNPRSTUVWXZ'[Math.floor(Math.random() * 22)]).join('');
    const plate = `BV 77 ${tag.slice(0, 3)}`;
    const csv = [
      'Nume client;Telefon;Mașina;Nr. înmatriculare;Data;Lucrare;Km;Total (lei)',
      `Ion Pop;${ion.national};Dacia Logan;${plate};14.03.2024;Schimb ulei și filtre;120.500;"1.250,50"`,
      `Ion Pop;${ion.national};Dacia Logan;${plate};02.02.2025;Plăcuțe frână;131.000;420`,
      `Maria Ene;${maria.national};Skoda Fabia;B 12 ${tag.slice(0, 3)};;;;`,
      'Vasile;;;;ieri;Revizie;;',
    ].join('\r\n');

    await signIn(page, shop.email, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await page.goto('/s/programari/nou');
    await page.getByRole('link', { name: 'Importă clienți din alt program' }).click();
    await expect(page).toHaveURL(/\/s\/programari\/import$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Importă clienți' })).toBeVisible();
    await expect(page.getByText('Adu-ți clienții din programul vechi', { exact: false })).toBeVisible();

    // A file that is not a table says so.
    await page
      .getByTestId('import-file')
      .setInputFiles({ name: 'vechi.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) });
    await expect(page.getByText('E un Excel vechi (.xls).', { exact: false })).toBeVisible();

    await page
      .getByTestId('import-file')
      .setInputFiles({ name: 'clienti.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await expect(page.getByText('4 rânduri în clienti.csv.', { exact: false })).toBeVisible();
    // The columns were recognized from the header.
    await expect(page.getByRole('combobox', { name: 'Nume client' })).toHaveValue('0');
    await expect(page.getByRole('combobox', { name: 'Nr. înmatriculare' })).toHaveValue('3');
    await expect(page.getByRole('combobox', { name: 'Suma' })).toHaveValue('7');
    await expect(page.getByRole('combobox', { name: 'Model' })).toHaveValue('');
    await expect(page.getByText('2 clienți · 2 mașini · 2 lucrări')).toBeVisible();
    await expect(page.getByText('rândul 5: dată greșită')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Primele rânduri' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'import');
    await shot(page, 't31a-import-check', name());

    await page.getByRole('button', { name: 'Importă', exact: true }).click();
    await expect(page.getByText('Gata: 2 clienți, 2 mașini, 2 lucrări.', { exact: false })).toBeVisible();
    const past = page.locator('main li').filter({ hasText: 'clienti.csv' });
    await expect(past).toContainText('2 clienți · 2 mașini · 2 lucrări');
    await shot(page, 't31a-import-done', name());

    // Istoric: the imported jobs, marked, outside the total.
    await page.getByRole('link', { name: 'Vezi Istoricul' }).click();
    await expect(page).toHaveURL(/\/s\/istoric/);
    const card = page.locator('main ul li').filter({ hasText: 'Plăcuțe frână' });
    await expect(card).toContainText('Importat');
    await expect(card).toContainText(plate);
    await expect(card).toContainText('420 lei');
    await expect(page.getByText('Lucrările importate nu intră în total.')).toBeVisible();
    await card.getByRole('button').first().click();
    await expect(card.getByRole('link', { name: 'Fișa mașinii' })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, 't31a-history', name());

    // Adaugă programare: the phone fills the name and offers the car.
    await page.goto('/s/programari/nou');
    await page.getByLabel('Telefon').fill(ion.national);
    await expect(page.getByText('Client cunoscut.')).toBeVisible();
    await expect(page.getByLabel('Nume')).toHaveValue('Ion Pop');
    await page
      .getByRole('group', { name: 'Mașinile lui:' })
      .getByRole('button', { name: new RegExp(`Dacia Logan ${plate}`) })
      .click();
    await expect(page.getByLabel('Marcă')).toHaveValue('Dacia');
    await expect(page.getByLabel('Nr. înmatriculare')).toHaveValue(plate);
    await expectAccessible(page, 'add booking known client');
    await shot(page, 't31a-known-client', name());

    // Undo: everything it brought goes.
    await page.goto('/s/programari/import');
    await past.getByRole('button', { name: 'Anulează importul' }).click();
    await past.getByRole('button', { name: 'Da, anulează' }).click();
    await expect(past).toContainText('Anulat');
    const left = await serviceRest<unknown[]>(`imported_jobs?select=id&shop_id=eq.${shop.shopId}`, 'GET');
    expect(left).toHaveLength(0);
    await page.goto('/s/istoric');
    await expect(page.locator('main').getByText('Plăcuțe frână')).toHaveCount(0);

    // In English.
    await serviceRest(`profiles?id=eq.${await userIdOf(shop.email)}`, 'PATCH', { lang: 'en' });
    await page.goto('/s/programari/import');
    await expect(page.getByRole('heading', { level: 1, name: 'Import clients' })).toBeVisible();
    await expect(page.locator('main').getByText('Undone')).toBeVisible();
    await expect(page.locator('main')).not.toContainText('Importă');
    await expectNoHorizontalScroll(page);
    await shot(page, 't31a-import-en', name());
  });

  test('a long imported history comes in pages; the search finds the older jobs too', async ({ page }) => {
    const shop = await createBookableShop('Atelier Arhiva', ['ulei']);
    const imp = await rpcAs<{ id: string }>(shop.email, 'shop_import_begin', {
      p_file_name: 'arhiva.csv',
      p_request_id: crypto.randomUUID(),
    });
    // 150 jobs, one a day back from 2024-12-31; the oldest is on a plate of its own.
    const rows = Array.from({ length: 150 }, (_, i) => {
      const day = new Date(Date.UTC(2024, 11, 31 - i)).toISOString().slice(0, 10);
      return {
        row: i + 2,
        name: `Client ${i}`,
        make: 'Dacia',
        model: 'Logan',
        plate: i === 149 ? 'CJ 99 OLD' : `BV ${10 + (i % 80)} ARH`,
        day,
        work: `Lucrare ${i}`,
        cost: 100 + i,
      };
    });
    await rpcAs(shop.email, 'shop_import_add', { p_import_id: imp.id, p_rows: rows, p_request_id: crypto.randomUUID() });

    await signIn(page, shop.email, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await page.goto('/s/istoric');
    const cards = page.locator('main ul li');
    await expect(cards).toHaveCount(100);
    await expect(page.getByText('Lucrare 149', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Arată mai multe' }).click();
    await expect(cards).toHaveCount(150);
    await expect(page.getByRole('button', { name: 'Arată mai multe' })).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    // The search runs in the database: a fresh page finds the oldest job by its plate.
    await page.goto('/s/istoric?q=cj99old');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('CJ 99 OLD');
    await shot(page, 't31a-history-search', name());
  });

  test('T31b: a client with the same confirmed phone gets the imported cars and history; the shop shares its link', async ({
    page,
    browser,
  }) => {
    const shop = await createBookableShop('Atelier Link', ['ulei']);
    const phone = uniquePhone();
    const tag = Array.from({ length: 3 }, () => 'ABCDEFGHJKLMNPRSTUVWXZ'[Math.floor(Math.random() * 22)]).join('');
    const logan = `BV 21 ${tag}`;
    const golf = `BV 22 ${tag}`;
    const imp = await rpcAs<{ id: string }>(shop.email, 'shop_import_begin', {
      p_file_name: 'clienti.csv',
      p_request_id: crypto.randomUUID(),
    });
    await rpcAs(shop.email, 'shop_import_add', {
      p_import_id: imp.id,
      p_rows: [
        {
          row: 2,
          name: 'Ion Pop',
          phone: phone.e164,
          make: 'Dacia',
          model: 'Logan',
          plate: logan,
          day: '2023-04-10',
          work: 'Schimb ulei',
          odometer: 98000,
          cost: 320,
        },
        {
          row: 3,
          name: 'Ion Pop',
          phone: phone.e164,
          make: 'Dacia',
          model: 'Logan',
          plate: logan,
          day: '2024-05-02',
          work: 'Plăcuțe frână',
          cost: 480,
        },
        { row: 4, name: 'Ion Pop', phone: phone.e164, make: 'VW', model: 'Golf', plate: golf },
      ],
      p_request_id: crypto.randomUUID(),
    });

    // The client makes an account with the same phone and confirms it.
    const client = await createUser('client', { phone: phone.e164, name: 'Ion Pop' });
    await verifyPhoneByAdmin(client);
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\//);
    await page.goto('/c/garaj');
    const loganCard = page.locator('main li').filter({ hasText: logan });
    await expect(loganCard).toContainText('Dacia Logan');
    await expect(page.locator('main li').filter({ hasText: golf })).toContainText('VW Golf');
    await expect(loganCard.getByRole('link', { name: /2 lucrări/ })).toBeVisible();
    // No paid report for a car with imported jobs only.
    await expect(loganCard.getByRole('link', { name: /raport/i })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, 't31b-garage', name());
    await loganCard.getByRole('link', { name: /2 lucrări/ }).click();
    await expect(page.getByText('Plăcuțe frână')).toBeVisible();
    await expect(page.getByText('Importat de Atelier Link').first()).toBeVisible();
    await expect(
      page.getByText('Lucrările importate nu intră în raportul oficial.', { exact: false }),
    ).toBeVisible();
    await expectAccessible(page, 'imported history');
    await shot(page, 't31b-history', name());

    // A signed-in client opening the shop's link lands on its page.
    await page.goto(`/atelier/${shop.shopId}`);
    await expect(page).toHaveURL(new RegExp(`/c/service/${shop.shopId}$`));

    // The shop: Cont → Linkul service-ului, with the QR code.
    const shopContext = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    await shopContext.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    const s = await shopContext.newPage();
    await signIn(s, shop.email, PASSWORD);
    await expect(s).toHaveURL(/\/s\/panou$/);
    await s.goto('/s/cont');
    await s.getByRole('link', { name: /Linkul service-ului/ }).click();
    await expect(s).toHaveURL(/\/s\/cont\/link$/);
    await expect(s.getByLabel('Linkul tău')).toContainText(`/atelier/${shop.shopId}`);
    await expect(s.getByRole('img', { name: 'Codul QR al linkului Atelier Link' })).toBeVisible();
    await expect(s.getByRole('button', { name: 'Tipărește afișul' })).toBeVisible();
    const download = s.waitForEvent('download');
    await s.getByRole('button', { name: 'Descarcă codul QR' }).click();
    expect((await download).suggestedFilename()).toBe('service-hub-qr.svg');
    await expectNoHorizontalScroll(s);
    await expectAccessible(s, 'shop link');
    await shot(s, 't31b-shop-link', name());
    // The poster: previewed on the screen, alone on the printed page.
    await expect(s.getByText('Programează-te online', { exact: true })).toHaveCount(2);
    await s.emulateMedia({ media: 'print' });
    await expect(s.getByText('Programează-te online', { exact: true }).filter({ visible: true })).toHaveCount(1);
    await expect(s.getByRole('button', { name: 'Tipărește afișul' })).toBeHidden();
    // One A4 page, edge to edge (Chromium prints PDF; the file stays with the screenshots).
    const pdf = await s.pdf({ preferCSSPageSize: true, printBackground: true });
    expect(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)).toHaveLength(1);
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+59\d(\.\d+)?\s+84\d(\.\d+)?\s*\]/);
    writeFileSync(`test-results/shots/t31b-poster-${name()}.pdf`, pdf);

    // In both languages, on A6 for the counter.
    await s.emulateMedia({ media: 'screen' });
    await s.getByRole('combobox', { name: 'Limba afișului' }).selectOption('both');
    await s.getByRole('combobox', { name: 'Mărime' }).selectOption('A6');
    await expect(s.getByText('Book online', { exact: true }).first()).toBeAttached();
    await s.emulateMedia({ media: 'print' });
    const small = await s.pdf({ preferCSSPageSize: true, printBackground: true });
    expect(small.toString('latin1')).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+29\d(\.\d+)?\s+4[12]\d(\.\d+)?\s*\]/);
    writeFileSync(`test-results/shots/t31b-poster-a6-${name()}.pdf`, small);
    await shot(s, 't31b-poster', name());
    await shopContext.close();

    // A visitor: the shop's card and the way in.
    const visitor = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    await visitor.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    const v = await visitor.newPage();
    await v.goto(`/atelier/${shop.shopId}`);
    await expect(v.getByRole('heading', { level: 1, name: 'Programează-te la Atelier Link' })).toBeVisible();
    await expect(v.getByText('Fără recenzii încă')).toBeVisible();
    await expectNoHorizontalScroll(v);
    await expectAccessible(v, 'shop link visitor');
    await shot(v, 't31b-visitor', name());
    await v.getByRole('link', { name: 'Creează cont' }).click();
    await expect(v).toHaveURL(/\/cont-nou/);
    expect(await v.evaluate(() => Object.keys(localStorage).some((k) => localStorage.getItem(k)?.includes('-')))).toBe(true);
    await v.goto('/atelier/00000000-0000-4000-8000-000000000000');
    await expect(v.getByText('Linkul nu mai merge.')).toBeVisible();
    await visitor.close();
  });
});
