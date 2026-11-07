import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { PASSWORD, SEED, SEED_ADMIN_TOTP, SEED_PASSWORD, createUser, totp } from './support';

// Support agents for the browser tests (A2, A3a): a new agent appointed the real way (the admin's
// function, the authenticator app set up through the Auth API), its sign-in with the 6-digit code,
// and calls to the database with a page's own token.

const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
/** The demo admin's authenticator app (supabase/seed/dev_seed.sql). */
const ADMIN_FACTOR = '30000000-0000-4000-8000-0000000000f1';

export async function authJson<T>(path: string, token: string | null, body: unknown): Promise<T> {
  const res = await fetch(`${API}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  expect(res.ok, `${path}: ${await res.clone().text()}`).toBe(true);
  return (await res.json()) as T;
}

const passwordToken = async (email: string, password: string) =>
  (await authJson<{ access_token: string }>('token?grant_type=password', null, { email, password })).access_token;

/** The second step through the Auth API: a session at aal2 (what the app has after the 6-digit code). */
export async function secondStepToken(token: string, factorId: string, secret: string): Promise<string> {
  const challenge = await authJson<{ id: string }>(`factors/${factorId}/challenge`, token, {});
  return (await authJson<{ access_token: string }>(`factors/${factorId}/verify`, token, { challenge_id: challenge.id, code: totp(secret) }))
    .access_token;
}

export async function rpc(token: string, fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; body: unknown }> {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return { ok: res.ok, body: await res.json().catch(() => null) };
}

/** The demo admin at aal2, through the API (the app does the same with its 6-digit code). */
export async function adminToken(): Promise<string> {
  // Tests running at the same time verify the same factor with the same code: Auth answers one of
  // them with an error now and then. A few tries, a moment apart.
  for (let attempt = 1; ; attempt++) {
    try {
      return await secondStepToken(await passwordToken(SEED.admin, SEED_PASSWORD), ADMIN_FACTOR, SEED_ADMIN_TOTP);
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

export interface Agent {
  email: string;
  displayId: string;
  secret: string;
}

/**
 * A new agent the way it happens for real: a new client account, appointed by the admin with a reason,
 * then its authenticator app set up (through the Auth API, as the app's setup screen does).
 */
export async function createAgent(): Promise<Agent> {
  const email = await createUser('client');
  const granted = await rpc(await adminToken(), 'admin_grant_support', { p_account: email, p_reason: 'Test A2', p_request_id: randomUUID() });
  expect(granted.ok, JSON.stringify(granted.body)).toBe(true);
  const token = await passwordToken(email, PASSWORD);
  const factor = await authJson<{ id: string; totp: { secret: string } }>('factors', token, { factor_type: 'totp', friendly_name: 'Service-Hub' });
  await secondStepToken(token, factor.id, factor.totp.secret);
  return { email, displayId: (granted.body as { display_id: string }).display_id, secret: factor.totp.secret };
}

/** Signs in as an agent: password, then the 6-digit code (the next one if this one was just used). */
export async function signInAgent(page: Page, agent: Agent) {
  await page.goto('/intra');
  await page.getByLabel('Email').fill(agent.email);
  await page.getByLabel('Parolă', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Intră în cont' }).click();
  const code = page.getByLabel(/^(Codul de 6 cifre|6-digit code)$/);
  for (let attempt = 0; attempt < 3; attempt++) {
    await code.fill(totp(agent.secret));
    await page.getByRole('button', { name: /^(Confirmă|Confirm)$/ }).click();
    try {
      await expect(code).toHaveCount(0, { timeout: 6_000 });
      return;
    } catch {
      // A code may be refused right after it was used: the next one comes within 30 s.
      await page.waitForTimeout(31_000 - (Date.now() % 30_000));
    }
  }
  throw new Error('the agent could not pass the second step');
}

/** The access token the app keeps for this tab's session. */
export async function appToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    for (const store of [localStorage, sessionStorage]) {
      for (const k of Object.keys(store)) {
        if (k.startsWith('sb-') && k.endsWith('-auth-token')) return (JSON.parse(store.getItem(k)!) as { access_token: string }).access_token;
      }
    }
    return '';
  });
}


export async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: test.info().project.use.viewport,
    hasTouch: test.info().project.use.hasTouch,
    timezoneId: 'Europe/Berlin',
    reducedMotion: 'reduce',
  });
  await context.addInitScript(() => {
    localStorage.setItem('sh_onboarding_off', '1');
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
  return context.newPage();
}
