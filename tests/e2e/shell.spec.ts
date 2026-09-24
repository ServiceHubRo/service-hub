import { expect, test, type Page } from '@playwright/test';
import { BACKEND, SEED, SEED_PASSWORD, expectNoHorizontalScroll, isDesktop, signIn } from './support';

const NAV = {
  client: ['Caută', 'Garaj', 'Programări', 'Mesaje', 'Cont'],
  service: ['Panou', 'Programări', 'Istoric', 'Mesaje', 'Cont'],
  admin: ['Prezentare', 'Service-uri', 'Clienți', 'Rezervări', 'Moderare'],
} as const;

const NAV_EN = {
  client: ['Search', 'Garage', 'Bookings', 'Messages', 'Account'],
  service: ['Dashboard', 'Bookings', 'History', 'Messages', 'Account'],
  admin: ['Overview', 'Shops', 'Clients', 'Bookings', 'Moderation'],
} as const;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

async function navLabels(page: Page): Promise<string[]> {
  const nav = page.getByRole('navigation', { name: /Navigare principală|Main navigation/ }).filter({ visible: true });
  await expect(nav).toHaveCount(1);
  // The visible label only (not a count badge or the text read out for it).
  return nav.getByRole('link').evaluateAll((links) =>
    links.map((link) =>
      Array.from(link.querySelectorAll('span'))
        .filter((s) => s.children.length === 0 && !s.closest('[aria-hidden="true"]') && !s.classList.contains('visually-hidden'))
        .map((s) => s.textContent ?? '')
        .join('')
        .trim(),
    ),
  );
}

test('landing shows the logo and "În curând" without wrapping the wordmark', async ({ page }) => {
  await page.goto('/');
  const wordmark = page.getByRole('img', { name: 'Service-Hub' });
  await expect(wordmark).toBeVisible();
  const box = await wordmark.boundingBox();
  expect(box!.height).toBeLessThan(50); // one line
  await expect(page.getByText('În curând')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Intră în cont' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Creează cont' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `test-results/shots/landing-${test.info().project.name}.png` });
});

test('no red database bar when the build reaches a database at the expected version', async ({ page }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Intră în cont' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/Baza de date|Nu pot citi versiunea|Build-ul nu știe/)).toHaveCount(0);
});

test('role screens need an account: signed-out visitors go to sign-in', async ({ page }) => {
  for (const path of ['/c/cauta', '/s/panou', '/admin/prezentare', '/c/cont']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/intra$/);
    await expect(page.getByRole('button', { name: 'Intră în cont' })).toBeVisible();
  }
});

for (const role of Object.keys(NAV) as (keyof typeof NAV)[]) {
  test(`${role} sees exactly its five navigation items`, async ({ page }) => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    // Shared demo accounts: switching to English must not change their saved language
    // (other tests, running in parallel, sign in as them too).
    await page.route('**/rest/v1/profiles?*', (route) =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue(),
    );
    await signIn(page, SEED[role === 'service' ? 'shop' : role], SEED_PASSWORD);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAV[role][0]);
    const labels = await navLabels(page);
    if (isDesktop(page) && role !== 'admin') {
      // Desktop: four main rows on top; Cont is pinned at the bottom.
      expect(labels.slice(0, 4)).toEqual(NAV[role].slice(0, 4));
      await expect(page.getByRole('link', { name: 'Cont' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Deconectare' })).toBeVisible();
    } else {
      expect(labels).toEqual([...NAV[role]]);
    }
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `test-results/shots/${role}-ro-${test.info().project.name}.png` });

    // Every item opens its screen.
    for (const label of NAV[role]) {
      // A count badge is read out after the label ("Programări, 1 cerere nouă").
      await page.getByRole('link', { name: new RegExp(`^${label}( ?,.*)?$`) }).filter({ visible: true }).first().click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(label);
    }

    // Switching to English changes every label.
    await page.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    const en = await navLabels(page);
    if (isDesktop(page) && role !== 'admin') expect(en.slice(0, 4)).toEqual(NAV_EN[role].slice(0, 4));
    else expect(en).toEqual([...NAV_EN[role]]);
    await page.screenshot({ path: `test-results/shots/${role}-en-${test.info().project.name}.png` });
  });
}

test('a client cannot open shop or admin screens', async ({ page }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  await signIn(page, SEED.client, SEED_PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta$/);
  await page.goto('/s/panou');
  await expect(page).toHaveURL(/\/c\/cauta$/);
  await page.goto('/admin/prezentare');
  await expect(page).toHaveURL(/\/c\/cauta$/);
});

test('a shop never sees the garage', async ({ page }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  await signIn(page, SEED.shop, SEED_PASSWORD);
  await expect(page).toHaveURL(/\/s\/panou$/);
  await page.goto('/c/garaj');
  await expect(page).toHaveURL(/\/s\/panou$/);
  await expect(page.getByText('Garaj')).toHaveCount(0);
});

test('log out returns to the public page and closes the role screens', async ({ page }) => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  await signIn(page, SEED.shop, SEED_PASSWORD);
  await expect(page).toHaveURL(/\/s\/panou$/);
  if (isDesktop(page)) {
    await page.getByRole('button', { name: 'Deconectare' }).click();
  } else {
    await page.getByRole('link', { name: 'Cont', exact: true }).click();
    await page.getByRole('button', { name: 'Deconectare' }).click();
  }
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/s/panou');
  await expect(page).toHaveURL(/\/intra$/);
});

test('offline bar appears and disappears', async ({ page, context }) => {
  await page.goto('/intra');
  await context.setOffline(true);
  await expect(page.getByText('Fără conexiune. Modificările nu se salvează.')).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Fără conexiune. Modificările nu se salvează.')).toHaveCount(0);
});

test('component gallery: action button, stepper, errors', async ({ page }) => {
  await page.goto('/dev/componente');
  await expectNoHorizontalScroll(page);

  const main = page.getByRole('main').or(page.locator('body'));
  const scroller = page.locator('[class*="page"]').first();
  await scroller.evaluate((el) => el.scrollTo(0, 600));
  const before = await scroller.evaluate((el) => el.scrollTop);
  await page.getByRole('button', { name: /Crește/ }).click();
  await page.getByRole('button', { name: /Crește/ }).click();
  await expect(page.locator('output')).toHaveText('7');
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(before);

  // Three fast taps on bad signal produce one submission.
  const ok = page.getByRole('button', { name: 'Confirmă (reușește)' });
  await ok.evaluate((el: HTMLElement) => {
    el.click();
    el.click();
    el.click();
  });
  const busy = page.locator('button[aria-busy="true"]');
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAccessibleName('Se trimite…');
  await expect(main.getByText('Trimiteri: 1')).toBeVisible();
  await expect(ok).toBeEnabled();

  await page.getByRole('button', { name: 'Trimite (eșuează)' }).click();
  await expect(page.getByText('Nu s-a putut trimite. Verifică internetul și încearcă din nou.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Încearcă din nou' })).toBeVisible();

  await page.screenshot({ path: `test-results/shots/components-${test.info().project.name}.png`, fullPage: false });
});

// Brand guide §2: the wrench is #151515 on amber, set through CSS (Safari ignores var() in SVG attributes).
test('logo wrench is black #151515 everywhere it appears', async ({ page, browser }) => {
  const expectBlackWrench = async (page: Page) => {
    const wrenches = page.locator('svg.lucide-wrench').filter({ visible: true });
    await expect(wrenches.first()).toBeVisible();
    for (const wrench of await wrenches.all()) {
      await expect(wrench).toHaveAttribute('stroke', 'currentColor');
      await expect(wrench.locator('path').first()).toHaveCSS('stroke', 'rgb(21, 21, 21)');
    }
  };
  await page.goto('/');
  await expectBlackWrench(page);
  await page.goto('/intra');
  await expectBlackWrench(page);
  if (BACKEND) {
    for (const email of [SEED.client, SEED.shop, SEED.admin]) {
      const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: page.viewportSize() });
      await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
      const other = await context.newPage();
      await signIn(other, email, SEED_PASSWORD);
      await expect(other).not.toHaveURL(/\/intra/);
      await expectBlackWrench(other);
      await context.close();
    }
  }
  await page.screenshot({ path: `test-results/shots/logo-${test.info().project.name}.png` });
});
