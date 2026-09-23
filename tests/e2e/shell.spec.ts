import { expect, test, type Page } from '@playwright/test';

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

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function navLabels(page: Page): Promise<string[]> {
  const nav = page.getByRole('navigation', { name: /Navigare principală|Main navigation/ }).filter({ visible: true });
  await expect(nav).toHaveCount(1);
  return (await nav.getByRole('link').allInnerTexts()).map((s) => s.trim());
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

test('landing shows the logo and "În curând" without wrapping the wordmark', async ({ page }) => {
  await page.goto('/');
  const wordmark = page.getByRole('img', { name: 'Service-Hub' });
  await expect(wordmark).toBeVisible();
  const box = await wordmark.boundingBox();
  expect(box!.height).toBeLessThan(50); // one line
  await expect(page.getByText('În curând')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `test-results/shots/landing-${test.info().project.name}.png` });
});

for (const role of Object.keys(NAV) as (keyof typeof NAV)[]) {
  test(`?rol=${role} shows exactly its five navigation items`, async ({ page }) => {
    await page.goto(`/?rol=${role}`);
    await expect(page).not.toHaveURL(/rol=/);
    const labels = await navLabels(page);
    if (isDesktop(page) && role !== 'admin') {
      // Desktop: four main rows on top; Cont is pinned at the bottom.
      expect(labels.slice(0, 4)).toEqual(NAV[role].slice(0, 4));
      await expect(page.getByRole('link', { name: 'Cont' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Deconectare' })).toBeVisible();
    } else {
      expect(labels).toEqual([...NAV[role]]);
    }
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAV[role][0]);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `test-results/shots/${role}-ro-${test.info().project.name}.png` });

    // Every item opens its screen.
    for (const label of NAV[role]) {
      await page.getByRole('link', { name: label, exact: true }).filter({ visible: true }).first().click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(label);
    }

    // Switching to English changes every label.
    await page.getByRole('button', { name: 'English' }).filter({ visible: true }).click();
    const en = await navLabels(page);
    if (isDesktop(page) && role !== 'admin') expect(en.slice(0, 4)).toEqual(NAV_EN[role].slice(0, 4));
    else expect(en).toEqual([...NAV_EN[role]]);
    await page.screenshot({ path: `test-results/shots/${role}-en-${test.info().project.name}.png` });
  });
}

test('a client cannot open shop or admin screens', async ({ page }) => {
  await page.goto('/?rol=client');
  await expect(page).toHaveURL(/\/c\/cauta$/);
  await page.goto('/s/panou');
  await expect(page).toHaveURL(/\/c\/cauta$/);
  await page.goto('/admin/prezentare');
  await expect(page).toHaveURL(/\/c\/cauta$/);
});

test('a shop never sees the garage', async ({ page }) => {
  await page.goto('/?rol=service');
  await expect(page).toHaveURL(/\/s\/panou$/);
  await page.goto('/c/garaj');
  await expect(page).toHaveURL(/\/s\/panou$/);
  await expect(page.getByText('Garaj')).toHaveCount(0);
});

test('log out returns to the public page and closes the role screens', async ({ page }) => {
  await page.goto('/?rol=service');
  await expect(page).toHaveURL(/\/s\/panou$/);
  if (isDesktop(page)) {
    await page.getByRole('button', { name: 'Deconectare' }).click();
  } else {
    await page.getByRole('link', { name: 'Cont', exact: true }).click();
    await page.getByRole('button', { name: 'Deconectare' }).click();
  }
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/s/panou');
  await expect(page).toHaveURL(/\/$/);
});

test('offline bar appears and disappears', async ({ page, context }) => {
  await page.goto('/?rol=client');
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
