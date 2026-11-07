import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  BACKEND,
  PASSWORD,
  SEED,
  SEED_ADMIN_TOTP,
  SEED_PASSWORD,
  adminOpen,
  createUser,
  expectAccessible,
  expectNoHorizontalScroll,
  expectNoRomanianText,
  isDesktop,
  rpcAs,
  shot,
  signIn,
  switchLanguage,
  totp,
} from './support';

// A2 — the support agent: appointed and withdrawn by the admin from the app (reason required, both in
// the audit log); no access before the second step of sign-in; three sections (Solicitări, Căutare,
// Cont); no admin, client or shop screen, whatever address is typed; the account search shows only
// what an agent needs; withdrawing the role ends the agent's sessions and API access at once.

const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
/** The demo admin's authenticator app (supabase/seed/dev_seed.sql). */
const ADMIN_FACTOR = '30000000-0000-4000-8000-0000000000f1';

const name = () => test.info().project.name;
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const nav = (page: Page) => page.getByRole('navigation', { name: /^(Navigare principală|Main navigation)$/ }).filter({ visible: true });

async function authJson<T>(path: string, token: string | null, body: unknown): Promise<T> {
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
async function secondStepToken(token: string, factorId: string, secret: string): Promise<string> {
  const challenge = await authJson<{ id: string }>(`factors/${factorId}/challenge`, token, {});
  return (await authJson<{ access_token: string }>(`factors/${factorId}/verify`, token, { challenge_id: challenge.id, code: totp(secret) }))
    .access_token;
}

async function rpc(token: string, fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; body: unknown }> {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return { ok: res.ok, body: await res.json().catch(() => null) };
}

/** The demo admin at aal2, through the API (the app does the same with its 6-digit code). */
async function adminToken(): Promise<string> {
  return secondStepToken(await passwordToken(SEED.admin, SEED_PASSWORD), ADMIN_FACTOR, SEED_ADMIN_TOTP);
}

interface Agent {
  email: string;
  displayId: string;
  secret: string;
}

/**
 * A new agent the way it happens for real: a new client account, appointed by the admin with a reason,
 * then its authenticator app set up (through the Auth API, as the app's setup screen does).
 */
async function createAgent(): Promise<Agent> {
  const email = await createUser('client');
  const granted = await rpc(await adminToken(), 'admin_grant_support', { p_account: email, p_reason: 'Test A2', p_request_id: randomUUID() });
  expect(granted.ok, JSON.stringify(granted.body)).toBe(true);
  const token = await passwordToken(email, PASSWORD);
  const factor = await authJson<{ id: string; totp: { secret: string } }>('factors', token, { factor_type: 'totp', friendly_name: 'Service-Hub' });
  await secondStepToken(token, factor.id, factor.totp.secret);
  return { email, displayId: (granted.body as { display_id: string }).display_id, secret: factor.totp.secret };
}

/** Signs in as an agent: password, then the 6-digit code (the next one if this one was just used). */
async function signInAgent(page: Page, agent: Agent) {
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
async function appToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    for (const store of [localStorage, sessionStorage]) {
      for (const k of Object.keys(store)) {
        if (k.startsWith('sb-') && k.endsWith('-auth-token')) return (JSON.parse(store.getItem(k)!) as { access_token: string }).access_token;
      }
    }
    return '';
  });
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

test.describe('support agent (A2)', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('three sections, no other role’s screen, the search and the card show only what an agent needs', async ({ page }) => {
    test.setTimeout(150_000);
    const agent = await createAgent();
    // A client with a suggestion, to find and to answer.
    const author = await createUser('client', { name: 'Elena Suportescu' });
    const idea = `Vreau programări recurente ${randomUUID().slice(0, 8)}`;
    await rpcAs(author, 'submit_suggestion', { p_body: idea, p_request_id: randomUUID() });

    await signInAgent(page, agent);
    await expect(page).toHaveURL(/\/suport\/solicitari$/);
    await expect(h1(page)).toHaveText('Solicitări');

    // Exactly its sections: Solicitări, Căutare and Cont (the sidebar keeps Cont at its bottom).
    await expect(nav(page).getByRole('link')).toHaveText(isDesktop(page) ? ['Solicitări', 'Căutare'] : ['Solicitări', 'Căutare', 'Cont']);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'Solicitări');
    await shot(page, 'a2-requests', name());

    // Solicitări: the suggestion, its author opens the card, a state change.
    const card = page.locator('main li').filter({ hasText: idea });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Planificată' }).click();
    await expect(card.getByText('Planificată').first()).toBeVisible();
    await expect(card.getByRole('button', { name: 'Planificată' })).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveText(/^\s*$/);

    // Every address of another role leads back to its own home; never a screen of the admin, client or shop.
    for (const address of ['/admin/panou', '/admin/platforma/jurnal', '/admin/parteneri/clienti', '/c/cauta', '/c/garaj', '/s/panou', '/c/cont/ajutor']) {
      await page.goto(address);
      await expect(page).toHaveURL(/\/suport\/solicitari$/);
      await expect(h1(page)).toHaveText('Solicitări');
    }
    // Inside its own space, an unknown address and an account that is not a client's or a shop's.
    await page.goto('/suport/cautare/00000000-0000-4000-8000-000000000000');
    await expect(h1(page)).not.toHaveText('Date de identificare');

    // Căutare: too short, then by email (exact), the card, Back keeps the list.
    await nav(page).getByRole('link', { name: 'Căutare' }).click();
    await expect(h1(page)).toHaveText('Căutare');
    const field = page.getByLabel('ID cont, email, telefon sau nume');
    await field.fill('ab');
    await page.getByRole('button', { name: 'Caută', exact: true }).click();
    await expect(page.getByText('Scrie cel puțin 3 caractere.')).toBeVisible();
    await expect(field).toBeFocused();
    await field.fill(author);
    await page.getByRole('button', { name: 'Caută', exact: true }).click();
    const row = page.getByRole('link', { name: /Elena Suportescu/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText(`${author[0]}***@`);
    await expect(page.locator('main')).not.toContainText(author);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'Căutare');
    await shot(page, 'a2-search', name());

    await row.click();
    await expect(h1(page)).toHaveText('Elena Suportescu');
    await expect(page.getByText('se termină în')).toBeVisible();
    await expect(page.getByText(idea)).toBeVisible();
    for (const hidden of ['Programări', 'Garaj', 'Mașini', 'Factur', 'Mesaje']) {
      await expect(page.locator('main')).not.toContainText(hidden);
    }
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'Fișa contului');
    await shot(page, 'a2-account-card', name());
    await page.goBack();
    await expect(h1(page)).toHaveText('Căutare');
    await expect(page.getByRole('link', { name: /Elena Suportescu/ })).toBeVisible();

    // Its own Cont: no client tools, no Ajutor, no account deletion.
    await page.getByRole('link', { name: 'Cont', exact: true }).filter({ visible: true }).first().click();
    await expect(h1(page)).toHaveText('Cont');
    await expect(page.getByText('Cont de agent de suport')).toBeVisible();
    await expect(page.getByRole('link', { name: /Ajutor și contact/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Șterge contul' })).toHaveCount(0);
    await shot(page, 'a2-account', name());

    // The API answers the same: no admin function, no other person's rows.
    const token = await appToken(page);
    for (const fn of ['admin_overview', 'admin_list_clients', 'admin_list_audit', 'admin_list_support_agents']) {
      const res = await rpc(token, fn, {});
      expect(res.ok, fn).toBe(false);
      expect(JSON.stringify(res.body), fn).toContain('not_allowed');
    }
    const bookings = await fetch(`${API}/rest/v1/bookings?select=id`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } });
    expect(await bookings.json()).toEqual([]);

    // English: the same sections, nothing left in Romanian.
    await switchLanguage(page, 'en');
    await expect(nav(page).getByRole('link', { name: 'Search' })).toBeVisible();
    await nav(page).getByRole('link', { name: 'Search' }).click();
    await expect(h1(page)).toHaveText('Search');
    await page.getByLabel('Account ID, email, phone or name').fill(author);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('link', { name: /Elena Suportescu/ })).toBeVisible();
    await expectNoRomanianText(page, 'Search (EN)');
    await shot(page, 'a2-search-en', name());
    await nav(page).getByRole('link', { name: 'Requests' }).click();
    await expect(h1(page)).toHaveText('Requests');
    await expectNoRomanianText(page, 'Requests (EN)');
    await switchLanguage(page, 'ro');

    // Every search and every opened card is in the admin's audit log, under the agent.
    const audit = await rpc(await adminToken(), 'admin_list_audit', { p_limit: 200 });
    const mine = (audit.body as { action: string; admin_display_id: string; actor_role: string }[]).filter(
      (e) => e.admin_display_id === agent.displayId,
    );
    expect(mine.filter((e) => e.action === 'support_search').length).toBeGreaterThanOrEqual(2);
    expect(mine.some((e) => e.action === 'support_view_account')).toBe(true);
    expect(mine.some((e) => e.action === 'update_suggestion')).toBe(true);
    expect(mine.every((e) => e.actor_role === 'support')).toBe(true);
  });

  test('the admin appoints an agent, the agent sets up its second step, withdrawing ends its access at once', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const email = await createUser('client', { name: 'Radu Echipă' });

    await signIn(page, SEED.admin, SEED_PASSWORD);
    await adminOpen(page, 'Platformă', 'Echipa de suport');
    await expect(h1(page)).toHaveText('Echipa de suport');

    // A reason is required; a shop account is refused.
    await page.getByLabel('ID cont sau email').fill(email);
    await page.getByRole('button', { name: 'Numește agentul' }).click();
    await expect(page.getByText('Scrie motivul.')).toBeVisible();
    await page.getByLabel('ID cont sau email').fill(SEED.shop);
    await page.getByLabel('Motiv').fill('Angajat nou, suport');
    await page.getByRole('button', { name: 'Numește agentul' }).click();
    await expect(page.getByText('Doar un cont de client poate deveni agent de suport.')).toBeVisible();

    await page.getByLabel('ID cont sau email').fill(email);
    await page.getByRole('button', { name: /^(Numește agentul|Încearcă din nou)$/ }).click();
    const notice = page.getByRole('status').filter({ hasText: /este agent de suport/ });
    await expect(notice).toBeVisible();
    const displayId = /E-\d{5}/.exec((await notice.textContent()) ?? '')![0];
    const agentCard = page.locator('main li').filter({ hasText: displayId });
    await expect(agentCard.getByText('Fără verificarea în doi pași, fără acces')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'Echipa de suport');
    await shot(page, 'a2-team', name());

    // The agent, in its own browser: the second step set up from the app, then its sections.
    const agentPage = await newPage(browser);
    await agentPage.goto('/intra');
    await agentPage.getByLabel('Email').fill(email);
    await agentPage.getByLabel('Parolă', { exact: true }).fill(PASSWORD);
    await agentPage.getByRole('button', { name: 'Intră în cont' }).click();
    await expect(agentPage.getByText(/Contul de agent de suport cere la fiecare intrare/)).toBeVisible();
    await shot(agentPage, 'a2-mfa-setup', name());
    await agentPage.getByRole('button', { name: 'Pornește configurarea' }).click();
    const secret = ((await agentPage.locator('p.mono').first().textContent()) ?? '').trim();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    await agentPage.getByLabel('Codul de 6 cifre').fill(totp(secret));
    await agentPage.getByRole('button', { name: 'Activează' }).click();
    await expect(h1(agentPage)).toHaveText('Solicitări');
    const oldToken = await appToken(agentPage);
    expect((await rpc(oldToken, 'support_list_suggestions', {})).ok).toBe(true);

    // The admin sees it active, then withdraws the role with a reason.
    await page.reload();
    await expect(agentCard.getByText('Activ', { exact: true })).toBeVisible();
    await agentCard.getByRole('button', { name: 'Retrage rolul' }).click();
    await expect(agentCard.getByText(`Retragi rolul de agent pentru ${displayId}?`)).toBeVisible();
    const reason = `Contract încheiat ${displayId}`;
    await agentCard.getByLabel('Motiv').fill(reason);
    await agentCard.getByRole('button', { name: 'Retrage rolul' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Rolul de agent pentru ${displayId} a fost retras.` })).toBeVisible();
    const former = page.locator('main section').filter({ has: page.getByRole('heading', { name: 'Foști agenți' }) });
    const formerCard = former.locator('li').filter({ hasText: displayId });
    await expect(formerCard).toBeVisible();
    await expect(formerCard.getByText(`Motiv: ${reason}`)).toBeVisible();
    await shot(page, 'a2-team-former', name());

    // At once: the token the agent still holds is refused, and its session cannot be renewed.
    const after = await rpc(oldToken, 'support_list_suggestions', {});
    expect(after.ok).toBe(false);
    expect(JSON.stringify(after.body)).toMatch(/not_allowed|not_signed_in/);
    await agentPage.reload();
    await expect(agentPage).not.toHaveURL(/\/suport\//, { timeout: 15_000 });
    await agentPage.close();

    // Both actions are in the audit log, with their reasons.
    await adminOpen(page, 'Platformă', 'Jurnal de audit');
    await expect(page.getByText('Rol de agent de suport retras').first()).toBeVisible();
    await expect(page.getByText('Agent de suport numit').first()).toBeVisible();
    await expect(page.getByText(reason).first()).toBeVisible();
  });
});

async function newPage(browser: Browser): Promise<Page> {
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
