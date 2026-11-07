import { expect, test, type Page } from '@playwright/test';
import { BACKEND, PASSWORD, rpcAs, signIn } from './support';
import { fleetSetup, openAs } from './fleet-support';

// P1 — the way back without loops. The in-app „‹ Înapoi” goes back through the history when the
// page before is its parent, and otherwise takes the place of the current entry: it never adds an
// entry, so the browser's Back (and the iPhone's swipe, the same history) and the in-app back never
// take turns. Every route of the audit (§8), with the history checked after each step.

const historyLength = (page: Page) => page.evaluate(() => window.history.length);
const backLink = (page: Page, name: string) => page.locator('[data-back-bar]').getByRole('link', { name });
const tabCont = (page: Page) => page.getByRole('link', { name: 'Cont', exact: true }).filter({ visible: true }).first();

test.describe('P1 — navigation', () => {
  test.describe.configure({ timeout: 150_000 });

  test('Cont → Firmele mele → firmă → Cont (tab): the browser Back walks the same way back, and forward again', async ({ browser }) => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    const f = await fleetSetup();
    const page = await openAs(browser, f.admin, 'ro', '/c/cont');
    await page.getByRole('link', { name: /Firmele mele/ }).first().click();
    await expect(page).toHaveURL(/\/c\/cont\/firme$/);
    await page.getByRole('link', { name: /Etape/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/c/cont/firme/${f.company}$`));
    await tabCont(page).click();
    await expect(page).toHaveURL(/\/c\/cont$/);
    const length = await historyLength(page);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/c/cont/firme/${f.company}$`));
    await page.goBack();
    await expect(page).toHaveURL(/\/c\/cont\/firme$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/c\/cont$/);
    await page.goForward();
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/c/cont/firme/${f.company}$`));
    expect(await historyLength(page)).toBe(length);
    await page.context().close();
  });

  test('the in-app back adds no entry: Firmele mele and Cont never take turns', async ({ browser }) => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    const f = await fleetSetup();
    const page = await openAs(browser, f.admin, 'ro', '/c/cont');
    await page.getByRole('link', { name: /Firmele mele/ }).first().click();
    await page.getByRole('link', { name: /Etape/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/c/cont/firme/${f.company}$`));
    const length = await historyLength(page);

    await backLink(page, 'Firmele mele').click();
    await expect(page).toHaveURL(/\/c\/cont\/firme$/);
    await backLink(page, 'Cont').click();
    await expect(page).toHaveURL(/\/c\/cont$/);
    expect(await historyLength(page), 'no entry added by the in-app back').toBe(length);
    // The browser Back now leaves Cont for the page before it, never Firmele mele again.
    await page.goBack();
    await expect(page).not.toHaveURL(/\/c\/cont\/firme/);
    // Forward still finds the pages left behind, in order.
    await page.goForward();
    await page.goForward();
    await expect(page).toHaveURL(/\/c\/cont\/firme$/);

    // Back and forth many times: the history keeps its length.
    for (let i = 0; i < 3; i++) {
      await page.getByRole('link', { name: /Etape/ }).first().click();
      await backLink(page, 'Firmele mele').click();
      await expect(page).toHaveURL(/\/c\/cont\/firme$/);
    }
    expect(await historyLength(page)).toBe(length);
    await page.context().close();
  });

  test('a direct link, a refresh: the in-app back takes the place of the entry, the browser Back goes where it came from', async ({ browser }) => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    const f = await fleetSetup();
    // Signed in, the app opens on Căutare; the company page is then opened by its address.
    const page = await openAs(browser, f.admin, 'ro', `/c/cont/firme/${f.company}`);
    const length = await historyLength(page);
    await backLink(page, 'Firmele mele').click();
    await expect(page).toHaveURL(/\/c\/cont\/firme$/);
    expect(await historyLength(page), 'replaced, not added').toBe(length);
    await page.goBack();
    await expect(page).toHaveURL(/\/c\/cauta/);

    // A refresh keeps the memory of the entries (per tab).
    await page.goForward();
    await page.getByRole('link', { name: /Etape/ }).first().click();
    await page.reload();
    await backLink(page, 'Firmele mele').click();
    await expect(page).toHaveURL(/\/c\/cont\/firme$/);
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/c/cont/firme/${f.company}$`));
    await page.context().close();
  });

  test('fleet space: Vehicule → vehicul → „Înapoi la vehicule” goes back; switching company and back return', async ({ browser }) => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    const f = await fleetSetup();
    const second = await rpcAs<{ id: string }>(f.admin, 'create_company', {
      p_name: `Doi ${Date.now()}`,
      p_vat_id: null,
      p_reg_com: null,
      p_address: null,
      p_request_id: crypto.randomUUID(),
    });
    const page = await openAs(browser, f.admin, 'ro', `/c/firme/${f.company}?sectiune=panou`);
    await page.goto(`/c/firme/${f.company}?sectiune=vehicule`);
    await page.getByRole('button', { name: new RegExp(f.plate) }).first().click();
    await expect(page).toHaveURL(new RegExp(`sectiune=vehicul&vehicul=${f.vehicle}`));
    const length = await historyLength(page);
    await page.getByRole('button', { name: 'Înapoi la vehicule' }).first().click();
    await expect(page).toHaveURL(/sectiune=vehicule$/);
    expect(await historyLength(page)).toBe(length);
    await page.goBack();
    await expect(page).toHaveURL(/sectiune=panou/);

    // The company switch is a forward step; Back returns to the first company.
    await page.goto(`/c/firme/${f.company}?sectiune=vehicule`);
    await page.getByRole('button', { name: /Spațiul activ:/ }).filter({ visible: true }).first().click();
    await page.getByRole('menuitemradio', { name: /Doi/ }).click();
    await expect(page).toHaveURL(new RegExp(`/c/firme/${second.id}\\?sectiune=vehicule`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/c/firme/${f.company}\\?sectiune=vehicule`));
    await page.context().close();
  });

  test('after logout and a new sign-in the way back still works', async ({ browser }) => {
    test.skip(!BACKEND, 'needs the local Supabase stack');
    const f = await fleetSetup();
    const page = await openAs(browser, f.admin, 'ro', '/c/cont');
    // Deconectare sits at the bottom of the side bar (laptop width).
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Deconectare' }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Deconectează-mă' }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await signIn(page, f.admin, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await tabCont(page).click();
    await page.getByRole('link', { name: /Firmele mele/ }).first().click();
    const length = await historyLength(page);
    await backLink(page, 'Cont').click();
    await expect(page).toHaveURL(/\/c\/cont$/);
    expect(await historyLength(page)).toBe(length);
    await page.context().close();
  });
});
