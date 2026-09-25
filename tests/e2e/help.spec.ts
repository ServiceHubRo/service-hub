import { expect, test } from '@playwright/test';
import { BACKEND, SEED, SEED_PASSWORD, expectAccessible, expectNoHorizontalScroll, isDesktop, openAccount, shot, signIn } from './support';

// Cont → Ajutor și contact: email and WhatsApp to the Service-Hub team, with the account ID
// written in the message; for clients and shops (the admin is the team).

test.skip(!BACKEND, 'needs the local Supabase stack');

const name = () => test.info().project.name;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

for (const [role, email, prefix] of [
  ['client', SEED.client, 'C-'],
  ['shop', SEED.shop, 'S-'],
] as const) {
  test(`${role}: Ajutor și contact from Cont, with the account ID in the message`, async ({ page }) => {
    // Shared demo accounts: the language switch must not be saved on their profile.
    await page.route('**/rest/v1/profiles?*', (route) =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue(),
    );
    await signIn(page, email, SEED_PASSWORD);
    await expect(page).not.toHaveURL(/\/intra/);
    await openAccount(page);
    await page.getByRole('link', { name: /^Ajutor și contact/ }).click();
    await expect(page).toHaveURL(role === 'client' ? /\/c\/cont\/ajutor$/ : /\/s\/cont\/ajutor$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Ajutor și contact' })).toBeVisible();
    await expect(page).toHaveTitle('Cont · Service-Hub');

    const id = (await page.getByText(new RegExp(`^${prefix}\\d{5}$`)).textContent())!;
    const mail = page.getByRole('link', { name: /Trimite-ne un email/ });
    await expect(mail).toHaveAttribute('href', `mailto:contact@service-hub.ro?subject=${encodeURIComponent(`Service-Hub · ${id}`)}`);
    const whatsapp = page.getByRole('link', { name: /Scrie-ne pe WhatsApp/ });
    const href = (await whatsapp.getAttribute('href'))!;
    expect(href.startsWith('https://wa.me/40723375248?text=')).toBe(true);
    expect(decodeURIComponent(href.split('text=')[1]!)).toContain(`ID-ul contului meu: ${id}.`);
    await expect(whatsapp).toHaveAttribute('target', '_blank');
    await expect(page.getByText(role === 'client' ? /scrie întâi service-ului, din Mesaje/ : /Pentru abonament, plăți/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, `${role} help (ro)`);
    await shot(page, `help-${role}-ro`, name());

    await page.getByRole('button', { name: 'English' }).filter({ visible: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Help and contact' })).toBeVisible();
    expect(decodeURIComponent((await page.getByRole('link', { name: /Message us on WhatsApp/ }).getAttribute('href'))!)).toContain(
      `My account ID: ${id}.`,
    );
    await expectAccessible(page, `${role} help (en)`);
    await shot(page, `help-${role}-en`, name());

    await page.getByRole('link', { name: 'Account' }).filter({ visible: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
    if (!isDesktop(page)) await expect(page.getByRole('link', { name: /^Help and contact/ })).toBeVisible();
  });
}

test('admin: no Ajutor și contact (the admin is the team)', async ({ page }) => {
  await signIn(page, SEED.admin, SEED_PASSWORD);
  await expect(page).toHaveURL(/\/admin\/prezentare$/);
  await openAccount(page);
  await expect(page.getByRole('link', { name: /Ajutor și contact/ })).toHaveCount(0);
  await page.goto('/admin/cont/ajutor');
  await expect(page.getByRole('heading', { level: 1, name: 'Pagina nu există' })).toBeVisible();
});
