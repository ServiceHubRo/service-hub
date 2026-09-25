import { expect, test } from '@playwright/test';
import { sentryReports } from './providers';
import {
  BACKEND,
  PASSWORD,
  SEED,
  SEED_PASSWORD,
  createUser,
  expectAccessible,
  expectNoHorizontalScroll,
  serviceRest,
  shot,
  signIn,
  userIdOf,
} from './support';

/** A fresh access token for an account made by createUser (the app's own sign-in does the same). */
async function accessTokenOf(email: string): Promise<string> {
  const res = await fetch(`${process.env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.ok).toBe(true);
  return ((await res.json()) as { access_token: string }).access_token;
}

// Error reports (T19). The browser-test builds send to the Sentry stand-in of providers.ts, which
// runs with the local backend; so do the local Edge Functions (supabase/config.toml).
test.skip(!BACKEND, 'needs the local stack (E2E_BACKEND=1): the Sentry stand-in runs with it');

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
});

/** Reports sent from a page whose address holds `marker`. */
async function reportsFrom(marker: string) {
  return (await sentryReports()).filter((e) => e.request?.url?.includes(marker));
}

test('a test error from the component page reaches Sentry, without tokens in the address', async ({ page }, info) => {
  const marker = `run-${crypto.randomUUID()}`;
  await page.goto(`/dev/componente?t=${marker}#access_token=eyJsecretsecret.eyJsecretsecret.sig`);
  await expect(page.getByText('Pornită: erorile ajung în Sentry.')).toBeVisible();
  await page.getByRole('button', { name: 'Trimite o eroare de test' }).click();
  await expect(page.getByText('Am trimis eroarea de test. Apare în Sentry în câteva secunde.')).toBeVisible();

  await expect.poll(async () => (await reportsFrom(marker)).length, { timeout: 10_000 }).toBe(1);
  const [event] = await reportsFrom(marker);
  expect(event!.exception.values[0]!.value).toMatch(/^Service-Hub test error /);
  expect(event!.tags).toMatchObject({ side: 'browser', test: 'yes' });
  expect(event!.environment).toBe('local-build');
  expect(event!.user).toBeUndefined();
  expect(event!.request!.url).not.toContain('access_token');
  await shot(page, 'monitoring-gallery', info.project.name);
});

test('a screen that breaks shows a message instead of a blank page, and is reported', async ({ page }, info) => {
  const marker = `crash-${crypto.randomUUID()}`;
  await page.goto(`/dev/componente?t=${marker}`);
  await page.getByRole('button', { name: 'Strică ecranul (test)' }).click();
  await expect(page.getByText('Ceva n-a mers pe această pagină. Reîncarcă pagina; dacă se repetă, revino puțin mai târziu.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reîncarcă pagina' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectAccessible(page, 'crash notice');
  await shot(page, 'monitoring-crash', info.project.name);

  await expect.poll(async () => (await reportsFrom(marker)).length, { timeout: 10_000 }).toBe(1);
  const [event] = await reportsFrom(marker);
  expect(event!.exception.values[0]!.value).toBe('Service-Hub test: screen broken on purpose');
  expect(event!.tags).toMatchObject({ side: 'browser', mechanism: 'react' });

  // The way out works: the page comes back.
  await page.getByRole('button', { name: 'Reîncarcă pagina' }).click();
  await expect(page.getByRole('button', { name: 'Strică ecranul (test)' })).toBeVisible();
});

test('the same message in English', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sh_lang', 'en'));
  await page.goto('/dev/componente');
  await expect(page.getByText('On: errors reach Sentry.')).toBeVisible();
  await page.getByRole('button', { name: 'Break this screen (test)' }).click();
  await expect(page.getByText('Something went wrong on this page. Reload it; if it happens again, come back a bit later.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload the page' })).toBeVisible();
});

test('a signed-in error carries the account id and role only', async ({ page }) => {
  await signIn(page, SEED.client, SEED_PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  const marker = `user-${crypto.randomUUID()}`;
  // An uncaught error on a signed-in screen (as if a button handler threw).
  await page.evaluate((m) => {
    history.replaceState(null, '', `/c/cauta?t=${m}`);
    setTimeout(() => {
      throw new Error('uncaught in a handler');
    });
  }, marker);
  await expect.poll(async () => (await reportsFrom(marker)).length, { timeout: 10_000 }).toBe(1);
  const [event] = await reportsFrom(marker);
  expect(event!.tags).toMatchObject({ side: 'browser', mechanism: 'onerror' });
  expect(event!.user!.role).toBe('client');
  expect(event!.user!.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(event)).not.toContain(SEED.client);
});

test('an Edge Function that fails reports it from the server', async () => {
  test.skip(test.info().project.name !== 'desktop-1440', 'server side: once is enough');
  // A shop owner whose Stripe customer the stand-in answers with 500 ("Stripe is down").
  const email = await createUser('shop');
  const ownerId = await userIdOf(email);
  const [shop] = await serviceRest<{ id: string }[]>(`shops?owner_id=eq.${ownerId}&select=id`, 'GET');
  const customer = `cus_down_${crypto.randomUUID()}`;
  await serviceRest(`subscriptions?shop_id=eq.${shop!.id}`, 'PATCH', { stripe_customer_id: customer });

  const res = await fetch(`${process.env.VITE_SUPABASE_URL}/functions/v1/stripe-portal`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessTokenOf(email)}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'unknown' });

  const fromPortal = async () => (await sentryReports()).filter((e) => e.tags.function === 'stripe-portal');
  await expect.poll(async () => (await fromPortal()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const event = (await fromPortal()).at(-1)!;
  expect(event.tags).toMatchObject({ side: 'server', function: 'stripe-portal' });
  expect(event.environment).toBe('local');
  expect(event.exception.values[0]!.value).toContain('Stripe is down');
  expect(JSON.stringify(event)).not.toContain(email);
});
