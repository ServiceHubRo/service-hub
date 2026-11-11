import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { adminToken, appToken, createAgent, newPage, rpc, signInAgent, type Agent } from './agent';
import {
  BACKEND,
  SEED,
  SEED_PASSWORD,
  adminOpen,
  createUser,
  expectAccessible,
  expectNoHorizontalScroll,
  expectNoRomanianText,
  functionAs,
  inboxRow,
  rpcAs,
  serviceRest,
  shot,
  signIn,
  switchLanguage,
  userIdOf,
} from './support';

// A3c2a — legal hold of support data: the admin places a hold on an account (validated: basis chosen,
// a concrete reason, a reference, no secrets) or on one request, reviews it and releases it; agents
// lose held requests everywhere and see them again after the release; an account deleted while its
// request is held keeps only that request, and its release deletes it. 390 / 820 / 1440 px, RO and EN.

const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? '';
const name = () => test.info().project.name;
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const stamp = () => Math.random().toString(36).slice(2, 8);
const REASON = 'Litigiu cu clientul privind plata, notificare de la avocat primită pe 10 noiembrie';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

async function request(email: string, title: string) {
  return (
    await rpcAs<{ id: string }>(email, 'create_support_request', {
      p_category: 'technical',
      p_title: title,
      p_body: `Descriere ${title}`,
      p_booking_ref: null,
      p_request_id: randomUUID(),
    })
  ).id;
}

const displayIdOf = async (id: string) =>
  (await serviceRest<{ display_id: string }[]>(`profiles?id=eq.${id}&select=display_id`, 'GET'))[0]!.display_id;

test.describe('legal hold (A3c2a)', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  let agent: Agent;
  test.beforeAll(async () => {
    agent = await createAgent();
  });

  test('the admin places a hold on an account, reviews and releases it; the agent loses the requests meanwhile', async ({ page, browser }) => {
    test.setTimeout(240_000);
    const s = stamp();
    const client = await createUser('client');
    const clientId = await userIdOf(client);
    const account = await displayIdOf(clientId);
    const first = await request(client, `Plată contestată ${s}`);
    await request(client, `Factură lipsă ${s}`);

    await signIn(page, SEED.admin, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/admin\//);
    await adminOpen(page, 'Suport', 'Păstrare legală');
    await expect(h1(page)).toHaveText('Păstrare legală');

    // Everything is required; the basis is chosen, never preselected.
    const form = page.locator('form').first();
    await form.getByRole('button', { name: 'Pune sub păstrare legală' }).click();
    await expect(form).toContainText('Scrie ID-ul contului.');
    await expect(form).toContainText('Alege temeiul.');
    await expect(form).toContainText('Motivul are cel puțin 30 de caractere.');
    await expect(form).toContainText('Referința are cel puțin 3 caractere.');
    await expectNoHorizontalScroll(page);
    await shot(page, 'a3c2a-holds-errors', name());

    await form.getByLabel('ID cont').fill(account);
    await form.getByLabel('Temei').selectOption('litigation');
    await form.getByLabel('Motiv concret').fill(`${REASON}, parola: Secret123!`);
    await form.getByLabel('Referință').fill('Dosar nr. 1234/180/2026');
    await form.getByRole('button', { name: 'Pune sub păstrare legală' }).click();
    await expect(form).toContainText('Textul pare să conțină o parolă, o cheie sau un număr de card.');
    await form.getByLabel('Motiv concret').fill(REASON);
    await form.getByRole('button', { name: 'Pune sub păstrare legală' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Păstrarea legală a fost pusă.' })).toBeVisible();
    const row = page.getByRole('link').filter({ hasText: account }).filter({ hasText: 'Cont întreg' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Solicitări acoperite: 2');
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'legal holds');
    await shot(page, 'a3c2a-holds', name());

    // The agent: the held requests do not exist, not in the list, not by address.
    const agentPage = await newPage(browser);
    await signInAgent(agentPage, agent);
    await expect(h1(agentPage)).toHaveText('Solicitări');
    await agentPage.goto('/suport/solicitari?stare=all');
    // Loaded (a list or the empty state), and neither held request in it.
    await expect(
      agentPage
        .getByRole('list', { name: 'Lista solicitărilor' })
        .or(agentPage.getByText(/^Nu există solicitări( pentru filtrele selectate)?\.$/)),
    ).toBeVisible();
    await expect(agentPage.getByText(s)).toHaveCount(0);
    await agentPage.goto(`/suport/solicitari/${first}`);
    await expect(agentPage.getByRole('heading', { level: 1 })).not.toHaveText(`Plată contestată ${s}`);
    await expect(agentPage.getByText(`Descriere Plată contestată ${s}`)).toHaveCount(0);
    const agentToken = await appToken(agentPage);
    const opened = await rpc(agentToken, 'support_get_request', { p_id: first });
    expect(JSON.stringify(opened.body)).toContain('request_not_found');
    await shot(agentPage, 'a3c2a-agent-not-found', name());

    // The admin's list marks them; the request page shows the hold.
    await page.goto('/admin/suport/solicitari?stare=all');
    await expect(inboxRow(page, `Plată contestată ${s}`)).toContainText('Păstrare legală');
    await inboxRow(page, `Plată contestată ${s}`).click();
    await expect(h1(page)).toHaveText(`Plată contestată ${s}`);
    const holdSection = page.getByRole('region', { name: 'Păstrare legală' });
    await expect(holdSection).toContainText('Agenții nu mai au acces la ea.');
    await expect(holdSection).toContainText('Cont întreg');
    await expectNoHorizontalScroll(page);
    await shot(page, 'a3c2a-request-held', name());

    // The hold page: identifiers, review, release.
    await holdSection.getByRole('link', { name: 'Vezi păstrarea' }).click();
    await expect(h1(page)).toHaveText('Păstrare legală');
    await expect(page.getByText(REASON)).toBeVisible();
    await expect(page.getByText(client)).toBeVisible();
    await page.getByLabel('De ce este încă necesară').fill('Prea scurt');
    await page.getByRole('button', { name: 'Confirmă revizuirea' }).click();
    await expect(page.getByText('Nota are cel puțin 30 de caractere.')).toBeVisible();
    await page.getByLabel('De ce este încă necesară').fill('Dosarul este încă pe rol, următorul termen în ianuarie 2027');
    await page.getByRole('button', { name: 'Confirmă revizuirea' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Revizuirea a fost salvată.' })).toBeVisible();
    await expect(page.getByText('Dosarul este încă pe rol, următorul termen în ianuarie 2027')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'legal hold');
    await shot(page, 'a3c2a-hold', name());

    await switchLanguage(page, 'en');
    await expect(h1(page)).toHaveText('Legal hold');
    await expect(page.getByText('Ongoing or imminent litigation')).toBeVisible();
    await expectNoRomanianText(page, 'legal hold (EN)');
    await expectNoHorizontalScroll(page);
    await shot(page, 'a3c2a-hold-en', name());
    await switchLanguage(page, 'ro');

    await page.getByRole('button', { name: 'Ridică păstrarea' }).click();
    await expect(page.getByText('Ridici păstrarea legală?')).toBeVisible();
    await page.getByLabel('Motivul ridicării').fill('Litigiul s-a încheiat prin tranzacție, dosar închis definitiv');
    await page.getByRole('button', { name: 'Ridică păstrarea' }).last().click();
    await expect(page.getByRole('status').filter({ hasText: 'Păstrarea a fost ridicată. Solicitări șterse: 0.' })).toBeVisible();
    await expect(page.getByText('Ridicate', { exact: true })).toBeVisible();
    await shot(page, 'a3c2a-hold-released', name());

    // The agent sees them again (the account is alive: nothing was deleted).
    expect((await rpc(agentToken, 'support_get_request', { p_id: first })).ok).toBe(true);
    await agentPage.goto('/suport/solicitari?stare=all');
    await expect(inboxRow(agentPage, s)).toHaveCount(2);
    await agentPage.context().close();

    // The released list, in English.
    await page.goto('/admin/suport/pastrare-legala?stare=ridicate');
    await switchLanguage(page, 'en');
    await expect(h1(page)).toHaveText('Legal hold');
    await expect(page.getByRole('link').filter({ hasText: account })).toBeVisible();
    await expectNoRomanianText(page, 'legal holds (EN)');
    await expectNoHorizontalScroll(page);
    await shot(page, 'a3c2a-holds-released-en', name());
    await switchLanguage(page, 'ro');
  });

  test('an account deleted while one request is held: the rest goes, the held request stays for the admin, its release deletes it', async ({ page }) => {
    test.skip(!name().startsWith('desktop'), 'the database paths do not depend on the width');
    test.setTimeout(120_000);
    const s = stamp();
    const client = await createUser('client');
    const clientId = await userIdOf(client);
    const held = await request(client, `Păstrată ${s}`);
    const other = await request(client, `Obișnuită ${s}`);
    const admin = await adminToken();
    const placed = await rpc(admin, 'admin_place_legal_hold', {
      p_suggestion: held,
      p_account: null,
      p_basis: 'authority_request',
      p_reason: 'Cererea ANPC nr. 55678 privind reclamația clientului, termen de răspuns 30 de zile',
      p_reference: 'ANPC 55678/2026',
      p_responsible: null,
      p_request_id: randomUUID(),
    });
    expect(placed.ok, JSON.stringify(placed.body)).toBe(true);
    const holdId = (placed.body as { id: string }).id;

    // The service key cannot delete a held request, nor empty the table.
    const direct = await fetch(`${API}/rest/v1/suggestions?id=eq.${held}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    expect(direct.ok).toBe(false);
    expect(await direct.text()).toContain('legal_hold');

    // The client deletes its own account through the app's Edge Function (delete-account).
    const deleted = await functionAs(client, 'delete-account', {});
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    const login = await fetch(`${API}/auth/v1/admin/users/${clientId}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    expect(login.status, 'the login itself is gone').toBe(404);
    expect(await serviceRest<unknown[]>(`profiles?id=eq.${clientId}&select=id`, 'GET')).toHaveLength(0);
    expect(await serviceRest<unknown[]>(`suggestions?id=eq.${other}&select=id`, 'GET')).toHaveLength(0);
    const kept = await serviceRest<{ author_id: string | null; former_author_id: string; status: string }[]>(
      `suggestions?id=eq.${held}&select=author_id,former_author_id,status`,
      'GET',
    );
    expect(kept).toEqual([{ author_id: null, former_author_id: clientId, status: 'closed' }]);

    // The admin sees whose it was.
    await signIn(page, SEED.admin, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/admin\//);
    await page.goto(`/admin/suport/solicitari/${held}`);
    await expect(h1(page)).toHaveText(`Păstrată ${s}`);
    await expect(page.getByText(/^Cont șters · C-\d+/).first()).toBeVisible();
    await shot(page, 'a3c2a-request-orphan', name());

    // Released: deleted at once, with its messages, notes and files.
    const released = await rpc(admin, 'admin_release_legal_hold', {
      p_id: holdId,
      p_reason: 'Autoritatea a închis cererea, nu mai este necesară păstrarea datelor',
      p_request_id: randomUUID(),
    });
    expect(released.ok, JSON.stringify(released.body)).toBe(true);
    expect((released.body as { deleted_requests: number }).deleted_requests).toBe(1);
    expect(await serviceRest<unknown[]>(`suggestions?id=eq.${held}&select=id`, 'GET')).toHaveLength(0);
  });
});
