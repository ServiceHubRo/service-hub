import { expect, test, type Page } from '@playwright/test';
import { BACKEND, expectAccessible, expectNoHorizontalScroll, shot } from './support';

// T18: the public page at `/`, the 404 page, link previews, and the public screens checked for
// accessibility and keyboard use (P17b, P18).

const name = () => test.info().project.name;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

test('landing: every section, in Romanian and English, without horizontal scroll', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Service-Hub — programări online la service auto');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Programarea la service ar trebui să dureze 2 minute.');
  for (const heading of [
    'Știi ce plătești înainte să se lucreze',
    'Ai atelier în Brașov?',
    'Patru pași',
    'Recenzii de la clienți reali.',
  ]) {
    await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
  }
  for (const card of [
    'Cauți după oraș sau intervenție',
    'Primești deviz și decizi tu',
    'Afli când e gata mașina',
    'Clienții se programează singuri',
    'Tu decizi câte mașini iei pe zi',
    'Deviz digital, acceptat de client în aplicație',
  ]) {
    await expect(page.getByRole('heading', { level: 3, name: card })).toBeVisible();
  }
  if (BACKEND) {
    // The prices come from Setări platformă.
    await expect(page.getByText('100 lei pe lună')).toBeVisible();
    await expect(page.getByText('primele 90 de zile gratuite')).toBeVisible();
    await expect(page.getByText(/Plus 20 lei pe lună pentru fiecare coleg/)).toBeVisible();
  }
  // Contact from the "în curând" page, legal documents and report verification in the footer.
  await expect(page.getByRole('link', { name: 'Email: contact@service-hub.ro' })).toHaveAttribute('href', 'mailto:contact@service-hub.ro');
  await expect(page.getByRole('link', { name: 'Telefon și WhatsApp: 0723 375 248' })).toHaveAttribute('href', 'https://wa.me/40723375248');
  for (const doc of ['Termeni și condiții', 'Politica de confidențialitate', 'Politica de cookies', 'Verifică un raport de istoric']) {
    await expect(page.getByRole('contentinfo').getByRole('link', { name: doc })).toBeVisible();
  }
  await expectNoHorizontalScroll(page);
  await shot(page, 'landing-ro', name());

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Booking a car repair should take 2 minutes.');
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Own a shop in Brașov?' })).toBeVisible();
  if (BACKEND) await expect(page.getByText('100 RON a month')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 'landing-en', name());
});

test('landing: "Sunt client" and "Sunt service" open sign-up with the role chosen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sunt client' }).click();
  await expect(page).toHaveURL(/\/cont-nou\?rol=client$/);
  await expect(page.getByRole('button', { name: 'Sunt client' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Numele service-ului')).toHaveCount(0);

  await page.goto('/');
  await page.getByRole('link', { name: 'Sunt service' }).click();
  await expect(page).toHaveURL(/\/cont-nou\?rol=service$/);
  await expect(page.getByRole('button', { name: 'Sunt service' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Numele service-ului')).toBeVisible();
  // Still changeable.
  await page.getByRole('button', { name: 'Sunt client' }).click();
  await expect(page.getByLabel('Numele service-ului')).toHaveCount(0);

  await page.goto('/');
  await page.getByRole('link', { name: 'Înscrie-ți service-ul' }).click();
  await expect(page).toHaveURL(/\/cont-nou\?rol=service$/);
});

test('landing: link previews have a title, a description and an absolute image', async ({ page, request }) => {
  await page.goto('/');
  const meta = (selector: string) => page.locator(selector).getAttribute('content');
  expect(await meta('meta[name="description"]')).toContain('Service-Hub');
  expect(await meta('meta[property="og:title"]')).toBe('Service-Hub — programări online la service auto');
  const image = (await meta('meta[property="og:image"]'))!;
  expect(image).toMatch(/^https?:\/\/[^/]+\/og-image\.png$/);
  const png = await request.get('/og-image.png');
  expect(png.ok()).toBe(true);
  expect(png.headers()['content-type']).toContain('image/png');
});

test('404: an unknown address has its own page with a way home', async ({ page }) => {
  await page.goto('/pagina-care-nu-exista');
  await expect(page.getByRole('heading', { level: 1, name: 'Pagina nu există' })).toBeVisible();
  await expect(page).toHaveTitle('Pagina nu există · Service-Hub');
  await expectNoHorizontalScroll(page);
  await shot(page, 'not-found', name());
  await page.getByRole('link', { name: 'Mergi la pagina principală' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Sunt client' })).toBeVisible();
});

/** Tab until the element is focused; fails after `max` presses. */
async function tabTo(page: Page, target: ReturnType<Page['getByRole']>, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('not reached with Tab');
}

/** The amber focus ring (P17b) is drawn around the focused element. */
async function expectFocusRing(target: ReturnType<Page['getByRole']>) {
  const shadow = await target.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).toContain('rgb(245, 165, 36)');
}

test('keyboard only: from the landing page to the sign-up form, with a visible focus ring', async ({ page }) => {
  await page.goto('/');
  const signUp = page.getByRole('link', { name: 'Sunt service' });
  await tabTo(page, signUp);
  await expectFocusRing(signUp);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/cont-nou\?rol=service$/);

  // The form is filled and its checkbox ticked without a mouse.
  const nameField = page.getByLabel('Nume și prenume');
  await tabTo(page, nameField);
  await expectFocusRing(nameField).catch(async () => {
    // Inputs show their focus with an amber border instead of the ring.
    expect(await nameField.evaluate((el) => getComputedStyle(el).borderColor)).toBe('rgb(245, 165, 36)');
  });
  await page.keyboard.type('Maria Pop');
  await expect(nameField).toHaveValue('Maria Pop');
  const terms = page.getByRole('checkbox');
  await tabTo(page, terms);
  await page.keyboard.press('Space');
  await expect(terms).toBeChecked();
});

for (const lang of ['ro', 'en'] as const) {
  test(`public screens pass the accessibility checks (${lang})`, async ({ page, context }) => {
    await context.addInitScript((l) => localStorage.setItem('sh_lang', l), lang);
    for (const path of ['/', '/intra', '/cont-nou', '/parola-uitata', '/legal/termeni', '/verifica', '/nu-exista']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (path === '/') await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await expectAccessible(page, `${path} (${lang})`);
    }
  });
}
