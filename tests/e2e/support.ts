import { expect, type Page } from '@playwright/test';

/**
 * Browser tests that need a backend run against the local Supabase stack (CLAUDE.md §9):
 *   npx supabase start …  then  E2E_BACKEND=1 VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=…
 *   E2E_SERVICE_ROLE_KEY=… npm run test:e2e
 * The CI workflow does exactly this. Without E2E_BACKEND those tests are skipped.
 */
export const BACKEND = process.env.E2E_BACKEND === '1';
const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? '';
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:54324';

/** Accounts from supabase/seed/dev_seed.sql. */
export const SEED_PASSWORD = 'Parola-Test-1';
export const SEED = {
  client: 'client@service-hub.test',
  shop: 'atelier@service-hub.test',
  admin: 'admin@service-hub.test',
} as const;

export const PASSWORD = 'Parola-Noua-2026';

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@service-hub.test`;
}

/** A confirmed account made through the Auth admin API (fast; the UI sign-up has its own test). */
export async function createUser(role: 'client' | 'shop', extra: Record<string, string> = {}): Promise<string> {
  const email = uniqueEmail(role);
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: {
        role,
        name: role === 'shop' ? 'Ion Popescu' : 'Maria Pop',
        phone: '+40723375248',
        lang: 'ro',
        terms_version: '2026-09',
        ...(role === 'shop' ? { shop_name: 'Atelier Test', city: 'Brașov' } : {}),
        ...extra,
      },
    }),
  });
  expect(res.ok, await res.clone().text()).toBe(true);
  return email;
}

/** Revokes every session of a user (as if they changed their password elsewhere). */
export async function revokeSessions(accessToken: string): Promise<void> {
  const res = await fetch(`${API}/auth/v1/logout?scope=global`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  expect(res.status).toBeLessThan(300);
}

/** The newest email sent to an address (local Mailpit), waiting for it to arrive. */
export async function latestEmail(to: string, subject: RegExp): Promise<{ text: string; link: string }> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const list = (await res.json()) as { messages: { ID: string; Subject: string }[] };
    const hit = list.messages.find((m) => subject.test(m.Subject));
    if (hit) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json()) as { Text: string };
      const link = /https?:\/\/\S+\/auth\/v1\/verify\?\S+/.exec(msg.Text)?.[0].replace(/&amp;/g, '&') ?? '';
      return { text: msg.Text, link };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email "${subject}" to ${to}`);
}

export async function signIn(page: Page, email: string, password: string, options: { remember?: boolean } = {}) {
  await page.goto('/intra');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Parolă', { exact: true }).fill(password);
  if (options.remember === false) await page.getByText('Ține-mă minte').click();
  await page.getByRole('button', { name: 'Intră în cont' }).click();
}

export const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Opens Cont from the navigation (bottom bar, sidebar, or the admin header icon). */
export async function openAccount(page: Page) {
  await page.getByRole('link', { name: 'Cont', exact: true }).filter({ visible: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Cont' })).toBeVisible();
}

export function shot(page: Page, name: string, projectName: string) {
  return page.screenshot({ path: `test-results/shots/${name}-${projectName}.png`, fullPage: true });
}
