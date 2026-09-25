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
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
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

/** The user id behind an email/password account (signs in through the Auth API). */
export async function userIdOf(email: string, password = PASSWORD): Promise<string> {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(res.ok, await res.clone().text()).toBe(true);
  return ((await res.json()) as { user: { id: string } }).user.id;
}

/** Calls a database function as a signed-in user, the way the app does (RLS and checks apply). */
export async function rpcAs<T = unknown>(email: string, fn: string, args: Record<string, unknown>, password = PASSWORD): Promise<T> {
  const auth = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(auth.ok, await auth.clone().text()).toBe(true);
  const token = ((await auth.json()) as { access_token: string }).access_token;
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  expect(res.ok, await res.clone().text()).toBe(true);
  return (await res.json()) as T;
}

/** Calls an Edge Function as a signed-in user, the way the app does; answers the status and body. */
export async function functionAs(
  email: string,
  fn: string,
  body: Record<string, unknown>,
  password = PASSWORD,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const auth = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(auth.ok, await auth.clone().text()).toBe(true);
  const token = ((await auth.json()) as { access_token: string }).access_token;
  const res = await fetch(`${API}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/**
 * What `select public.verify_phone_manually('…')` does in the SQL Editor (not callable through the
 * API): marks the account's phone as verified. Here through the service role, test stack only.
 */
export async function verifyPhoneByAdmin(email: string): Promise<void> {
  const id = await userIdOf(email);
  const res = await fetch(`${API}/rest/v1/profiles?id=eq.${id}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone_verified_by_admin: true }),
  });
  expect(res.ok, await res.clone().text()).toBe(true);
}

/** A request to the local REST API as the service role (test stack only; bypasses RLS). */
export async function serviceRest<T = unknown>(path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown): Promise<T> {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.ok, await res.clone().text()).toBe(true);
  return (await res.json()) as T;
}

/**
 * A new shop that clients can book: phone verified by hand, the given services offered, default
 * hours (Mon–Fri 08:00–18:00), and any booking rules to change. Returns the shop id.
 */
export async function createBookableShop(
  shopName: string,
  services: string[],
  rules: Record<string, number> = {},
  extra: Record<string, string> = {},
): Promise<{ email: string; shopId: string }> {
  const email = await createUser('shop', { shop_name: shopName, ...extra });
  await verifyPhoneByAdmin(email);
  const owner = await userIdOf(email);
  const [shop] = await serviceRest<{ id: string }[]>(`shops?owner_id=eq.${owner}&select=id`, 'GET');
  const shopId = shop!.id;
  await serviceRest('shop_services', 'POST', services.map((service_id) => ({ shop_id: shopId, service_id })));
  if (Object.keys(rules).length > 0) await serviceRest(`shops?id=eq.${shopId}`, 'PATCH', rules);
  return { email, shopId };
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

/** The app's scroll container (the page itself never scrolls inside the shell). */
export function scrollTopOf(page: Page): Promise<number> {
  return page.locator('main').evaluate((el) => el.scrollTop);
}

/**
 * WCAG 2.1 AA checks on what is on screen now (axe-core), plus the project's own rule: every
 * button and every link that stands on its own is at least 44 × 44 px (CLAUDE.md §6.13). Links
 * inside a sentence are exempt (they follow the text).
 */
export async function expectAccessible(page: Page, label: string) {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const violations = result.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).slice(0, 6).join('\n    ')}`,
  );
  expect(violations, `${label}: accessibility`).toEqual([]);

  const small = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, a[href], [role="button"], select, input[type="checkbox"], input[type="radio"]'))) {
      if (el.closest('[aria-hidden="true"], [hidden], .visually-hidden, [inert]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      // A link (or link-styled button) inside running text follows the text size (WCAG 2.5.8
      // "inline" exception).
      const inText = Array.from(el.parentElement?.childNodes ?? []).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
      );
      if (style.display.startsWith('inline') && inText) continue;
      // A native checkbox or radio hidden under its custom look: its label is the target.
      if ((el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio') {
        if (Number(style.opacity) === 0 || el.closest('label')) continue;
      }
      if (r.height < 43.5 || r.width < 43.5) {
        out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return out;
  });
  expect(small, `${label}: tap targets under 44 px`).toEqual([]);
}
