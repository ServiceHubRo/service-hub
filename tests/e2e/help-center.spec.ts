import { expect, test, type Page } from '@playwright/test';
import { createAgent, newPage, signInAgent } from './agent';
import {
  BACKEND,
  PASSWORD,
  SEED,
  SEED_PASSWORD,
  adminOpen,
  createUser,
  expectAccessible,
  expectNoHorizontalScroll,
  expectNoRomanianText,
  isDesktop,
  shot,
  signIn,
  switchLanguage,
} from './support';

// A4 — Help Center: a client searches (results as it types, no reload, diacritics ignored, a clear
// message without results), opens categories, articles and frequent questions, answers „Ți-a fost
// util acest articol?” (kept, changeable) and never reaches a shop article; a shop sees its own
// categories first; a new support request suggests articles without blocking anything; the admin
// writes a draft, publishes it, withdraws it and deletes it; an agent reads every audience.
// 390 / 820 / 1440 px, Romanian and English.

const name = () => test.info().project.name;
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const stamp = () => Math.random().toString(36).slice(2, 8);
const main = (page: Page) => page.locator('main');
const search = (page: Page) => page.getByLabel(/^(Caută în Centrul de ajutor|Search the Help Center)$/);

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

test.describe('Help Center (A4)', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('client: search, categories, an article, feedback, frequent questions, RO and EN', async ({ page }) => {
    test.setTimeout(150_000);
    const client = await createUser('client');
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);

    await page.goto('/c/cont/ajutor');
    await expect(h1(page)).toHaveText('Ajutor și contact');
    await expect(page.getByRole('heading', { name: 'Articole recomandate' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Categorii' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Întrebări frecvente' })).toBeVisible();
    // A client's own category first; never the shops' one.
    await expect(page.getByRole('link', { name: /^Pentru șoferi/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Pentru service-uri/ })).toHaveCount(0);
    // The way to the team stays (A3).
    await expect(page.getByRole('link', { name: /^Solicitările mele/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'help center (ro)');
    await shot(page, 'a4-help-client-ro', name());

    // Search: results while typing, without reloading the page; case and diacritics ignored.
    await page.evaluate(() => ((window as unknown as { __sameDocument: boolean }).__sameDocument = true));
    await search(page).fill('ROVINIETA');
    await expect(page.getByRole('link', { name: /^ITP, RCA, rovinietă și revizii/ })).toBeVisible();
    await expect(page).toHaveURL(/q=ROVINIETA/);
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
    await shot(page, 'a4-help-search', name());
    await search(page).fill('programările mele');
    await expect(main(page).getByRole('link', { name: /^Programări/ }).first()).toBeVisible();
    await search(page).fill('zzzqqq');
    await expect(page.getByText('Nu există articole pentru „zzzqqq”.')).toBeVisible();
    await expect(page.getByText('Încearcă alte cuvinte sau trimite o solicitare echipei Service-Hub.')).toBeVisible();
    await page.getByRole('button', { name: 'Șterge căutarea' }).click();
    await expect(page.getByRole('heading', { name: 'Categorii' })).toBeVisible();

    // A frequent question opens in place.
    await page.getByText('Cât costă Service-Hub pentru șoferi?').click();
    await expect(page.getByText('Contul de client este gratuit.').first()).toBeVisible();

    // A category, then an article.
    await page.getByRole('link', { name: /^Pentru șoferi/ }).click();
    await expect(h1(page)).toHaveText('Pentru șoferi');
    await main(page).getByRole('link', { name: /^Programări/ }).first().click();
    await expect(h1(page)).toHaveText('Programări');
    await expect(page.getByText('Alege serviciile (cel mult 5), ziua, ora și mașina.')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'help article (ro)');
    await shot(page, 'a4-help-article', name());

    // „Ți-a fost util acest articol?” — kept after a reload, and changeable.
    await expect(page.getByRole('heading', { name: 'Ți-a fost util acest articol?' })).toBeVisible();
    await page.getByRole('button', { name: 'Da', exact: true }).click();
    await expect(page.getByText('Răspunsul a fost înregistrat.')).toBeVisible();
    await page.getByRole('button', { name: 'Schimbă răspunsul' }).click();
    await page.getByRole('button', { name: 'Nu', exact: true }).click();
    await expect(page.getByText(/^Răspunsul a fost înregistrat\. Pentru o întrebare rămasă/)).toBeVisible();
    await page.reload();
    await expect(page.getByText('Răspunsul tău: Nu')).toBeVisible();
    // The way to a support request, under the article.
    await expect(page.getByRole('link', { name: 'Trimite o solicitare' })).toHaveAttribute('href', '/c/cont/ajutor/solicitari/noua');

    // A shop article is not reachable by its address.
    await page.goto('/c/cont/ajutor/articol/devize-service');
    await expect(page.getByText('Articolul nu există.')).toBeVisible();
    await page.goto('/c/cont/ajutor/categorie/service-uri');
    await expect(page.getByText('Categoria nu există.')).toBeVisible();

    // English: the same Help Center in English only.
    await page.goto('/c/cont/ajutor');
    await switchLanguage(page, 'en');
    await expect(h1(page)).toHaveText('Help and contact');
    await search(page).fill('vignette');
    await expect(page.getByRole('link', { name: /^ITP inspection, RCA insurance, road vignette and servicing/ })).toBeVisible();
    await search(page).fill('');
    await expect(page.getByRole('heading', { name: 'Frequent questions' })).toBeVisible();
    await expectNoRomanianText(page, 'help center (en)');
    await expectAccessible(page, 'help center (en)');
    await shot(page, 'a4-help-client-en', name());
    await page.getByRole('link', { name: /^For drivers/ }).click();
    await main(page).getByRole('link', { name: /^Bookings/ }).first().click();
    await expect(h1(page)).toHaveText('Bookings');
    await expect(page.getByText('Your answer: No')).toBeVisible();
    await expectNoRomanianText(page, 'help article (en)');
  });

  test('shop: its own categories first, never the drivers’ ones', async ({ page }) => {
    const shop = await createUser('shop');
    await signIn(page, shop, PASSWORD);
    await expect(page).toHaveURL(/\/s\//);
    await page.goto('/s/cont/ajutor');
    await expect(h1(page)).toHaveText('Ajutor și contact');
    const categories = page.getByRole('heading', { name: 'Categorii' }).locator('xpath=..').getByRole('link');
    await expect(categories.first()).toHaveText(/^Pentru service-uri/);
    await expect(page.getByRole('link', { name: /^Pentru șoferi/ })).toHaveCount(0);
    await search(page).fill('manoperă');
    await expect(page.getByRole('link', { name: /^Devize și aprobări/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'shop help center');
    await shot(page, 'a4-help-shop', name());
  });

  test('a new support request suggests articles, opened in place; nothing is blocked', async ({ page }) => {
    const client = await createUser('client');
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await page.goto('/c/cont/ajutor/solicitari/noua');
    await expect(h1(page)).toHaveText('Solicitare nouă');
    await page.getByLabel('Titlu').fill('Am uitat parola contului');
    await expect(page.getByRole('heading', { name: 'Articole care pot ajuta' })).toBeVisible();
    await page.getByText('Recuperarea parolei', { exact: true }).click();
    await expect(page.getByText('Scrie adresa contului și apasă').first()).toBeVisible();
    await expect(page.getByLabel('Titlu')).toHaveValue('Am uitat parola contului');
    await expect(page.getByRole('button', { name: 'Trimite solicitarea' })).toBeEnabled();
    await expectNoHorizontalScroll(page);
    await shot(page, 'a4-request-suggestions', name());
  });

  test('admin: a draft, published, read by a client, withdrawn and deleted; its history', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const title = `Articol de test ${stamp()}`;
    await signIn(page, SEED.admin, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/admin\//);
    await adminOpen(page, 'Suport', 'Centrul de ajutor');
    await expect(h1(page)).toHaveText('Centrul de ajutor');
    await expect(page.getByRole('heading', { name: 'Pentru șoferi' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'admin help center');
    await shot(page, 'a4-admin-list', name());

    await page.getByRole('link', { name: 'Articol nou' }).click();
    await expect(h1(page)).toHaveText('Articol nou');
    await page.getByLabel('Titlu').first().fill(title);
    await page.getByLabel('Text', { exact: true }).first().fill('Un text <b>cu HTML</b>.');
    await expect(page.getByText('Fără etichete HTML.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvează articolul' })).toBeDisabled();
    await page.getByLabel('Text', { exact: true }).first().fill('Primul paragraf al articolului.\n\n- un pas\n- alt pas');
    await expect(page.getByRole('listitem').filter({ hasText: 'alt pas' })).toBeVisible(); // the preview
    await page.getByRole('button', { name: 'Salvează articolul' }).click();
    await expect(page).toHaveURL(/\/admin\/suport\/centrul-de-ajutor\/articol\/[0-9a-f-]{36}$/);
    await expect(page.getByText('Articolul a fost creat ca ciornă.')).toBeVisible();
    await expect(h1(page)).toHaveText('Editează articolul');
    await expectAccessible(page, 'admin help editor');
    await shot(page, 'a4-admin-editor', name());

    // A draft is not shown to a client.
    const reader = await newPage(browser);
    const client = await createUser('client');
    await signIn(reader, client, PASSWORD);
    await expect(reader).toHaveURL(/\/c\/cauta/);
    await reader.goto(`/c/cont/ajutor?q=${encodeURIComponent(title)}`);
    await expect(reader.getByText(`Nu există articole pentru „${title}”.`)).toBeVisible();

    // Published: the client finds it (Romanian only: it has no English text).
    await page.getByRole('button', { name: 'Publică' }).click();
    await expect(page.getByText('Articolul a fost publicat.')).toBeVisible();
    await reader.reload();
    await expect(reader.getByRole('link', { name: new RegExp(`^${title}`) })).toBeVisible();

    // Withdrawn: gone for the client; then deleted.
    await page.getByRole('button', { name: 'Retrage' }).click();
    await expect(page.getByText('Articolul a fost retras.')).toBeVisible();
    await reader.reload();
    await expect(reader.getByText(`Nu există articole pentru „${title}”.`)).toBeVisible();

    await page.getByText(/^Versiunea 1 · Creat/).click();
    await expect(page.getByRole('button', { name: 'Copiază în editor' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Șterge articolul' }).click();
    await page.getByRole('button', { name: 'Da, șterge' }).click();
    await expect(page).toHaveURL(/\/admin\/suport\/centrul-de-ajutor$/);
    await expect(page.getByText(title)).toHaveCount(0);
    await reader.close();
  });

  test('agent: the Help Center in its menu, every audience, no feedback buttons', async ({ page }) => {
    test.setTimeout(120_000);
    const agent = await createAgent();
    await signInAgent(page, agent);
    await expect(h1(page)).toHaveText('Solicitări');
    await page
      .getByRole('navigation', { name: 'Navigare principală' })
      .filter({ visible: true })
      .getByRole('link', { name: isDesktop(page) ? 'Centrul de ajutor' : 'Ajutor' })
      .click();
    await expect(h1(page)).toHaveText('Centrul de ajutor');
    await expect(page.getByRole('link', { name: /^Pentru șoferi/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Pentru service-uri/ })).toBeVisible();
    await page.getByLabel('Pentru', { exact: true }).selectOption({ label: 'Service-uri' });
    await expect(page.getByRole('link', { name: /^Pentru șoferi/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Pentru service-uri/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'agent help center');
    await shot(page, 'a4-help-agent', name());
    await page.getByRole('link', { name: /^Pentru service-uri/ }).click();
    await page.getByRole('link', { name: /^Devize și aprobări/ }).click();
    await expect(h1(page)).toHaveText('Devize și aprobări');
    await expect(page.getByRole('heading', { name: 'Ți-a fost util acest articol?' })).toHaveCount(0);
  });
});
