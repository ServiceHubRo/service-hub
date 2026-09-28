import { expect, test } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  createBookableShop,
  expectNoHorizontalScroll,
  serviceRest,
  shot,
  signIn,
  uniqueEmail,
  uniquePhone,
} from './support';

// Shop referrals: the owner finds the code and the link on Abonament; a new shop opens the link,
// the code is already filled in (a wrong one is refused on the form); when the new shop pays, the
// owner's list and free months change live.

const name = () => test.info().project.name;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

test.describe('shop referrals', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(90_000);

  test('the code goes out as a link, the new shop signs up with it, its first payment brings a free month', async ({ page, browser }) => {
    const { email, shopId } = await createBookableShop(`Atelier Recomandă ${Date.now()}`, ['ulei']);
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou$/);
    await page.goto('/s/cont/abonament');
    await expect(page.getByRole('heading', { name: 'Recomandă Service-Hub' })).toBeVisible();
    const code = (await page.locator('span.mono').filter({ hasText: /^S-\d{5,}$/ }).textContent())!.trim();
    await expect(page.getByText('Niciun service adus încă.')).toBeVisible();
    await expect(page.getByText('Luni gratuite primite: 0 din 12')).toBeVisible();
    const whatsapp = page.getByRole('link', { name: 'Trimite pe WhatsApp' });
    await expect(whatsapp).toHaveAttribute('href', new RegExp(`^https://wa\\.me/\\?text=.*${code}`));
    const link = await page.getByLabel('Linkul de înscriere').inputValue();
    expect(link).toContain(`/cont-nou?rol=service&cod=${code}`);
    await page.getByRole('heading', { name: 'Recomandă Service-Hub' }).scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 'referral-card-empty', name());

    // ------------------------------------------------------------ the new shop, from the link
    const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    await other.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
    const newcomer = await other.newPage();
    await newcomer.goto(new URL(link).pathname + new URL(link).search);
    await expect(newcomer.getByRole('button', { name: 'Sunt service' })).toHaveAttribute('aria-pressed', 'true');
    const codeField = newcomer.getByLabel('Cod de recomandare (opțional)');
    await expect(codeField).toHaveValue(code);
    const newEmail = uniqueEmail('shop-referred');
    const newName = `Auto Recomandat ${Date.now()}`;
    await newcomer.getByLabel('Nume și prenume').fill('Dan Marin');
    await newcomer.getByLabel('Numele service-ului').fill(newName);
    await newcomer.getByLabel('Oraș').fill('Brașov');
    await newcomer.getByLabel('Telefon').fill(uniquePhone().national);
    await newcomer.getByLabel('Email').fill(newEmail);
    await newcomer.getByLabel('Parolă', { exact: true }).fill(PASSWORD);
    await newcomer.getByLabel('Repetă parola').fill(PASSWORD);
    await newcomer.getByRole('checkbox').check();
    await codeField.fill('S-99999');
    await newcomer.getByRole('button', { name: 'Creează cont' }).click();
    await expect(newcomer.getByText('Nu am găsit acest cod. Verifică-l sau lasă câmpul gol.')).toBeVisible();
    await expect(codeField).toBeFocused();
    await expectNoHorizontalScroll(newcomer);
    await shot(newcomer, 'referral-signup-wrong-code', name());
    await codeField.fill(code.toLowerCase());
    await expect(codeField).toHaveValue(code);
    await newcomer.getByRole('button', { name: 'Creează cont' }).click();
    await expect(newcomer).toHaveURL(/\/confirma-email$/);
    await other.close();

    // Not confirmed yet (no sign-in): found by its name.
    const [newShop] = await serviceRest<{ id: string }[]>(`shops?name=eq.${encodeURIComponent(newName)}&select=id`, 'GET');
    const [referral] = await serviceRest<{ status: string; referrer_shop_id: string }[]>(
      `shop_referrals?shop_id=eq.${newShop!.id}&select=status,referrer_shop_id`,
      'GET',
    );
    expect(referral).toEqual({ status: 'signed_up', referrer_shop_id: shopId });
    await page.reload();
    await expect(page.getByText(newName)).toBeVisible();
    await expect(page.getByText('În perioada gratuită', { exact: true })).toBeVisible();

    // ------------------------------------------------------------ the new shop pays: 30 more free days, live
    await serviceRest('invoices', 'POST', {
      shop_id: newShop!.id,
      amount: 99,
      status: 'paid',
      provider: 'stripe',
      stripe_invoice_id: `in_referral_${Date.now()}`,
      issued_at: new Date().toISOString(),
    });
    await expect(page.getByText('Luni gratuite primite: 1 din 12')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('A plătit', { exact: true })).toBeVisible();
    await expect(page.getByText(/Perioada ta gratuită: \+30 de zile/)).toBeVisible();
    await expect(page.getByText(/Mai ai 1[12]\d de zile gratuite/)).toBeVisible();
    await page.getByRole('heading', { name: 'Service-urile aduse' }).scrollIntoViewIfNeeded();
    await expectNoHorizontalScroll(page);
    await shot(page, 'referral-card-rewarded', name());

    // The profile's language wins in the app.
    const [owner] = await serviceRest<{ owner_id: string }[]>(`shops?id=eq.${shopId}&select=owner_id`, 'GET');
    await serviceRest(`profiles?id=eq.${owner!.owner_id}`, 'PATCH', { lang: 'en' });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Refer Service-Hub' })).toBeVisible();
    await expect(page.getByText('Free months earned: 1 of 12')).toBeVisible();
    await expect(page.getByText(/Your free period: \+30 days/)).toBeVisible();
    await page.getByRole('heading', { name: 'Shops you brought' }).scrollIntoViewIfNeeded();
    await shot(page, 'referral-card-rewarded-en', name());
  });
});
