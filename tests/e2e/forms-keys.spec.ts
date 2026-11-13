import { expect, test } from '@playwright/test';
import { BACKEND, SEED, SEED_PASSWORD, serviceRest, signIn } from './support';

// The fix batch after the audit of 13 Nov 2026: Enter submits a form (FUN-01), the quote's lines take
// Enter as „next line” (never sending the quote), Escape closes a confirm panel and gives the focus
// back to what opened it (FUN-03). The CORS of the Edge Functions (SEC-04) is covered by
// tests/unit/cors.test.ts: the local stack's gateway adds its own `*` to every function answer.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

test.describe('keyboard on forms and panels', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('Enter in a field of „Adaugă programare” submits it', async ({ page }) => {
    await signIn(page, SEED.shop, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/s\//);
    await page.goto('/s/programari/nou');
    const name = page.getByLabel('Nume');
    await name.fill('Dan Marin');
    await name.press('Enter');
    // Submitted: the checks of the missing fields answer, the page stays.
    await expect(page.getByText('Completează câmpurile marcate.')).toBeVisible();
    await expect(page).toHaveURL(/\/s\/programari\/nou$/);
  });

  test('Enter in a line of the quote goes to the next line, never sends the quote', async ({ page }) => {
    const [booking] = await serviceRest<{ id: string }[]>('bookings?select=id&status=eq.in_inspection&limit=1', 'GET');
    test.skip(!booking, 'the demo data has no booking in inspection');
    await signIn(page, SEED.shop, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/s\//);
    await page.goto(`/s/programari/deviz/${booking!.id}`);
    const names = page.locator('main [data-field="name"]');
    await expect(names.first()).toBeVisible();
    const before = await names.count();
    await names.first().fill('Înlocuire plăcuțe');
    await names.first().press('Enter');
    await expect(names).toHaveCount(before + 1);
    await expect(names.nth(1)).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`/s/programari/deviz/${booking!.id}$`));
    const [after] = await serviceRest<{ status: string }[]>(`bookings?select=status&id=eq.${booking!.id}`, 'GET');
    expect(after!.status).toBe('in_inspection');
  });

  test('Escape closes the cancel panel and the focus returns to „Mai multe”', async ({ page }) => {
    await signIn(page, SEED.client, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/c\//);
    await page.goto('/c/programari');
    const more = page.getByRole('button', { name: 'Mai multe' }).first();
    await expect(more).toBeVisible();
    await more.focus();
    await page.keyboard.press('Enter');
    const cancel = page.getByRole('menuitem', { name: 'Anulează' });
    test.skip((await cancel.count()) === 0, 'the first booking cannot be canceled');
    await cancel.click();
    const title = page.getByRole('heading', { name: 'Anulezi programarea?' });
    await expect(title).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(title).toHaveCount(0);
    await expect(more).toBeFocused();
  });

});
