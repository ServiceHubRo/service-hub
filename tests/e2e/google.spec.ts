import { expect, test } from '@playwright/test';
import { BACKEND, PASSWORD, asGoogleSignUp, createUser, expectNoHorizontalScroll, serviceRest, shot } from './support';

// T48: "Continuă cu Google". The local stack has Google turned on (supabase/config.toml), so the
// button shows; the browser is stopped on its way to Google. A first Google sign-in is played by an
// account with provider google and no profile: "Finalizează contul" makes it.

test.skip(!BACKEND, 'needs the local Supabase stack');

const name = () => test.info().project.name;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
});

async function signInWithPassword(page: import('@playwright/test').Page, email: string) {
  await page.goto('/intra');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Parolă', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Intră în cont' }).click();
}

test('the button leaves for Google and comes back to sign-in; the role chosen on Cont nou is kept', async ({ page }) => {
  let authorize: URL | null = null;
  await page.route('**/auth/v1/authorize?**', async (route) => {
    authorize = new URL(route.request().url());
    await route.fulfill({ contentType: 'text/html', body: '<p>Google</p>' });
  });
  await page.goto('/cont-nou?rol=service&cod=S-00001');
  const google = page.getByRole('button', { name: 'Continuă cu Google' });
  await expect(google).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 't48-signup-google', name());
  await google.click();
  await expect(page.getByText('Google', { exact: true })).toBeVisible();
  expect(authorize).not.toBeNull();
  expect(authorize!.searchParams.get('provider')).toBe('google');
  expect(new URL(authorize!.searchParams.get('redirect_to')!).pathname).toBe('/intra');
  await page.goBack();
  expect(await page.evaluate(() => sessionStorage.getItem('sh_google_signup'))).toBe(JSON.stringify({ role: 'shop', referral: 'S-00001' }));

  // Back without signing in (refused on Google's page): sign-in says so.
  await page.goto('/intra#error=access_denied&error_description=denied');
  await expect(page.getByText('Conectarea cu Google nu a reușit. Încearcă din nou.')).toBeVisible();
});

test('a first Google sign-in finishes the account: a shop, with its shop and free period', async ({ page }) => {
  const email = await createUser('client');
  const id = await asGoogleSignUp(email);
  await page.addInitScript(() => sessionStorage.setItem('sh_google_signup', JSON.stringify({ role: 'shop' })));
  await signInWithPassword(page, email);

  await expect(page.getByRole('heading', { level: 1, name: 'Finalizează contul' })).toBeVisible();
  await expect(page.getByText(`Conectat cu Google: ${email}`)).toBeVisible();
  await expect(page.getByLabel('Nume și prenume')).toHaveValue('Ion Google');
  await expect(page.getByRole('button', { name: 'Sunt service' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Parolă', { exact: true })).toHaveCount(0);
  // No other screen opens meanwhile.
  await page.goto('/s/panou');
  await expect(page.getByRole('heading', { level: 1, name: 'Finalizează contul' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, 't48-complete', name());

  await page.getByRole('button', { name: 'Creează cont' }).click();
  await expect(page.getByText('Scrie numele service-ului.')).toBeVisible();
  await page.getByLabel('Numele service-ului').fill('Atelier Google');
  await page.getByLabel('Oraș').fill('Cluj-Napoca');
  await page.getByLabel('Telefon').fill('0722 333 444');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Creează cont' }).click();
  await expect(page).toHaveURL(/\/s\/panou$/);

  const [profile] = await serviceRest<{ role: string; name: string; terms_version: string }[]>(`profiles?id=eq.${id}&select=role,name,terms_version`, 'GET');
  expect(profile).toMatchObject({ role: 'shop', name: 'Ion Google' });
  const shops = await serviceRest<{ name: string; city: string }[]>(`shops?owner_id=eq.${id}&select=name,city`, 'GET');
  expect(shops).toEqual([{ name: 'Atelier Google', city: 'Cluj-Napoca' }]);
});

test('Finish your account in English; Cancel signs out', async ({ page }) => {
  const email = await createUser('client');
  await asGoogleSignUp(email);
  await page.addInitScript(() => localStorage.setItem('sh_lang', 'en'));
  await page.goto('/intra');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Finish your account' })).toBeVisible();
  await expect(page.getByRole('button', { name: "I'm a client" })).toHaveAttribute('aria-pressed', 'false');
  await expectNoHorizontalScroll(page);
  await shot(page, 't48-complete-en', name());
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});
