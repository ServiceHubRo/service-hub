import { expect, test } from '@playwright/test';
import { PUBLISHED_PORT } from './ports';
import { BACKEND, PASSWORD, createUser, openAccount, serviceRest, signIn } from './support';

// The published site (not a deploy preview): real accounts only — the T01 role switch is gone —
// and developer-only pages stay hidden.
test.use({ baseURL: `http://localhost:${PUBLISHED_PORT}` });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('sh_lang', 'ro'));
});

test('published site: the landing page leads to sign-in and sign-up, no test links', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Componente' })).toHaveCount(0);
  await expect(page.getByText('Rol de test')).toHaveCount(0);
  await page.getByRole('link', { name: 'Creează cont' }).click();
  await expect(page).toHaveURL(/\/cont-nou$/);
  await expect(page.getByRole('button', { name: 'Sunt client' })).toBeVisible();
  await page.screenshot({ path: `test-results/shots/published-signup-${test.info().project.name}.png` });
});

test('published site: ?rol= no longer opens anything', async ({ page }) => {
  await page.goto('/?rol=client');
  await expect(page.getByRole('link', { name: 'Intră în cont' })).toBeVisible();
  await page.goto('/c/cauta?rol=client');
  await expect(page).toHaveURL(/\/intra$/);
});

test('published site: the component gallery is not reachable', async ({ page }) => {
  await page.goto('/dev/componente');
  await expect(page.getByRole('heading', { level: 1, name: 'Pagina nu există' })).toBeVisible();
});

test('published site: search engines may index the public pages, with a sitemap', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.ok()).toBe(true);
  const txt = await robots.text();
  expect(txt).toContain('Allow: /');
  expect(txt).toContain('Disallow: /c/');
  expect(txt).toContain('Disallow: /p/');
  expect(txt).toMatch(/Sitemap: https?:\/\/\S+\/sitemap\.xml/);
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain('/legal/termeni</loc>');
});

test('published site: the public page carries its official address and structured data (T46)', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const canonical = html.match(/<link rel="canonical" href="([^"]+)" \/>/)![1]!;
  expect(canonical).toMatch(/^https:\/\/\S+\/$/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.+?)<\/script>/)![1]!);
  const organization = ld['@graph'].find((node: { '@type': string }) => node['@type'] === 'Organization');
  expect(organization.url).toBe(canonical);
  expect(organization.email).toBe('contact@service-hub.ro');
  expect(html).toMatch(/<h1[^>]*>Programarea la service/);
});

test('published site: no companies tile in Cont and no fleet preview, even with fleets on (T63b)', async ({ page }) => {
  await page.goto('/dev/flota');
  await expect(page.getByRole('heading', { level: 1, name: 'Pagina nu există' })).toBeVisible();
  test.skip(!BACKEND, 'the Cont check needs the local Supabase stack');
  await serviceRest('platform_settings?id=eq.1', 'PATCH', { fleet_enabled: true });
  const email = await createUser('client');
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/c\/cauta/);
  await openAccount(page);
  await expect(page.getByRole('link', { name: /Date pentru deviz/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Firmele mele/ })).toHaveCount(0);
});
