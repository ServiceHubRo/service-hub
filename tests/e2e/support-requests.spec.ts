import { expect, test, type Page } from '@playwright/test';
import { appToken, createAgent, newPage, rpc, signInAgent, type Agent } from './agent';
import {
  BACKEND,
  PASSWORD,
  SEED,
  SEED_PASSWORD,
  createUser,
  expectAccessible,
  expectNoHorizontalScroll,
  expectNoRomanianText,
  serviceRest,
  shot,
  signIn,
  switchLanguage,
} from './support';

// A3a — support requests: a client writes one from Cont → Ajutor și contact → Solicitările mele, an
// agent takes it, notes something only the team sees, answers; the client sees "Echipa Service-Hub",
// never the note or who answered; answers back; „Rezolvată” and a message in the 14 days reopens it.
// An agent escalates one (reason required) and can then only read it; the admin answers and gives it
// back. Every screen at 390 / 820 / 1440 px, in Romanian and English.

const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const name = () => test.info().project.name;
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const stamp = () => Math.random().toString(36).slice(2, 8);

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

async function newRequest(page: Page, title: string, body: string) {
  await page.goto('/c/cont/ajutor');
  await page.getByRole('link', { name: /^Solicitările mele/ }).click();
  await expect(h1(page)).toHaveText('Solicitările mele');
  await page.getByRole('link', { name: 'Solicitare nouă' }).click();
  await expect(h1(page)).toHaveText('Solicitare nouă');
  await page.getByLabel('Categorie').selectOption({ label: 'Probleme tehnice' });
  await page.getByLabel('Titlu').fill(title);
  await page.getByLabel('Descriere').fill(body);
  await page.getByRole('button', { name: 'Trimite solicitarea' }).click();
  await expect(h1(page)).toHaveText(title);
}

async function agentOpens(page: Page, agent: Agent, title: string) {
  await signInAgent(page, agent);
  await expect(h1(page)).toHaveText('Solicitări');
  await page.getByRole('link').filter({ hasText: title }).click();
  await expect(h1(page)).toHaveText(title);
}

test.describe('support requests (A3a)', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('a client writes, an agent notes and answers, the client sees only the team’s answer, solved and reopened', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const client = await createUser('client', { name: 'Dan Solicitant' });
    const agent = await createAgent();
    const title = `Nu se încarcă Garajul ${stamp()}`;
    const note = `NOTA-INTERNA-${stamp()}`;

    // The client: Cont → Ajutor și contact → Solicitările mele, empty at first.
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await page.goto('/c/cont/ajutor');
    await page.getByRole('link', { name: /^Solicitările mele/ }).click();
    await expect(page.getByText('Nu există solicitări.')).toBeVisible();
    await shot(page, 'a3a-my-empty', name());

    // A new request: everything missing is named, an unknown booking code refused.
    await page.getByRole('link', { name: 'Solicitare nouă' }).click();
    await page.getByRole('button', { name: 'Trimite solicitarea' }).click();
    await expect(page.getByText('Alege categoria.')).toBeVisible();
    await expect(page.getByText('Scrie un titlu de cel puțin 3 caractere.')).toBeVisible();
    await expect(page.getByText('Scrie descrierea.')).toBeVisible();
    await page.getByLabel('Categorie').selectOption({ label: 'Probleme tehnice' });
    await page.getByLabel('Titlu').fill(title);
    await page.getByLabel('Descriere').fill('Ecranul rămâne gol după ce deschid Garajul.');
    await page.getByLabel('Codul programării (opțional)').fill('P-999999');
    await expect(page.getByText('Nu scrie parole, date bancare sau date personale de care echipa nu are nevoie.')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'Solicitare nouă');
    await shot(page, 'a3a-new', name());
    await page.getByRole('button', { name: 'Trimite solicitarea' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /programare/i }).first()).toBeVisible();
    await page.getByLabel('Codul programării (opțional)').fill('');
    await page.getByRole('button', { name: /^(Trimite solicitarea|Încearcă din nou)$/ }).click();
    await expect(h1(page)).toHaveText(title);
    await expect(page.locator('main').getByText('Primită', { exact: true })).toBeVisible();
    const requestUrl = page.url();
    // Away from the request: an open request shows the team's answer live and counts it as read (A3c1).
    await page.goto('/c/cont/ajutor');

    // The agent takes it, writes a note and answers.
    const agentPage = await newPage(browser);
    await agentOpens(agentPage, agent, title);
    await expect(agentPage.getByText('Fără responsabil').first()).toBeVisible();
    await agentPage.getByRole('button', { name: 'Preia solicitarea' }).click();
    await expect(agentPage.getByText(`${agent.displayId} · Maria Pop`).first()).toBeVisible();
    await agentPage.getByLabel('Notă nouă').fill(`${note} clientul are Android 10`);
    await agentPage.getByRole('button', { name: 'Adaugă nota' }).click();
    await expect(agentPage.getByText(note, { exact: false })).toBeVisible();
    await agentPage.getByLabel('Răspuns către utilizator').fill('Ce browser folosești?');
    await agentPage.getByLabel('Starea după răspuns').selectOption({ label: 'Așteaptă utilizatorul' });
    await agentPage.getByRole('button', { name: 'Trimite răspunsul' }).click();
    await expect(agentPage.getByText('Ce browser folosești?')).toBeVisible();
    await expect(agentPage.locator('main').getByText('Așteaptă utilizatorul', { exact: true }).first()).toBeVisible();
    await expectNoHorizontalScroll(agentPage);
    await expectAccessible(agentPage, 'Solicitare (agent)');
    await shot(agentPage, 'a3a-agent-request', name());

    // The client: a new answer, signed by the team; never the note, never the agent's ID.
    await page.goto('/c/cont/ajutor/solicitari');
    const row = page.getByRole('link').filter({ hasText: title });
    await expect(row).toContainText('Răspuns nou');
    await expect(row).toContainText('Așteaptă răspunsul tău');
    await shot(page, 'a3a-my-list', name());
    await row.click();
    await expect(page.getByText('Ce browser folosești?')).toBeVisible();
    await expect(page.getByText('Echipa Service-Hub').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(note);
    await expect(page.locator('body')).not.toContainText(agent.displayId);
    await page.getByLabel('Mesajul tău').fill('Chrome, pe telefon.');
    await page.getByRole('button', { name: 'Trimite mesajul' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Mesaj trimis.' })).toBeVisible();
    await expect(page.locator('main').getByText('În lucru', { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'Solicitarea mea');
    await shot(page, 'a3a-my-request', name());

    // Through the API too: no note, no team function, no direct row of another table.
    const token = await appToken(page);
    const notes = await fetch(`${API}/rest/v1/suggestion_notes?select=*`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } });
    expect(notes.ok).toBe(false);
    const asTeam = await rpc(token, 'support_list_requests', {});
    expect(JSON.stringify(asTeam.body)).toContain('not_allowed');
    const exported = await rpc(token, 'export_my_data', {});
    expect(JSON.stringify(exported.body)).not.toContain(note);

    // Solved; a message in the 14 days reopens it.
    await agentPage.reload();
    await expect(agentPage.getByText('Chrome, pe telefon.')).toBeVisible();
    await agentPage.getByRole('combobox', { name: 'Stare', exact: true }).selectOption({ label: 'Rezolvată' });
    await agentPage.getByRole('button', { name: 'Schimbă starea' }).click();
    await expect(agentPage.locator('main').getByText('Rezolvată', { exact: true }).first()).toBeVisible();
    await page.goto(requestUrl);
    await expect(page.locator('main').getByText('Rezolvată', { exact: true })).toBeVisible();
    await expect(page.getByText(/Un mesaj nou redeschide solicitarea, până pe/)).toBeVisible();
    await page.getByLabel('Mesajul tău').fill('Problema a revenit.');
    await page.getByRole('button', { name: 'Trimite mesajul' }).click();
    await expect(page.locator('main').getByText('În lucru', { exact: true })).toBeVisible();

    // The client is told by push and email, without the team's words.
    const events = await serviceRest<{ event: string; channels: string[]; params: Record<string, unknown> }[]>(
      `notification_events?select=event,channels,params&event=in.(support_reply,support_resolved)&params->>title=eq.${encodeURIComponent(title)}`,
      'GET',
    );
    expect(events.map((e) => e.event).sort()).toEqual(['support_reply', 'support_resolved']);
    expect(events.every((e) => e.channels.join(',') === 'push,email')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('Ce browser');

    // English.
    await switchLanguage(page, 'en');
    await page.goto(requestUrl);
    await expect(page.getByText('Service-Hub team').first()).toBeVisible();
    await expect(page.locator('main').getByText('In progress', { exact: true })).toBeVisible();
    await expectNoRomanianText(page, 'My request (EN)');
    await shot(page, 'a3a-my-request-en', name());
    await switchLanguage(page, 'ro');
    await agentPage.close();
  });

  test('an agent escalates with a reason and can then only read; the admin answers and gives it back', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const client = await createUser('client');
    const agent = await createAgent();
    const title = `Cont posibil compromis ${stamp()}`;
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await newRequest(page, title, 'Am primit un email de resetare pe care nu l-am cerut.');

    const agentPage = await newPage(browser);
    await agentOpens(agentPage, agent, title);
    await agentPage.getByRole('button', { name: 'Escaladează' }).click();
    await agentPage.getByRole('button', { name: 'Escaladează' }).last().click();
    await expect(agentPage.getByText('Scrie motivul.')).toBeVisible();
    await agentPage.getByLabel('Motiv').fill('Posibil acces neautorizat');
    await agentPage.getByRole('button', { name: 'Escaladează' }).last().click();
    await expect(agentPage.getByText(/^Escaladată de E-\d{5}/)).toBeVisible();
    await expect(agentPage.getByText('Doar administratorul o poate modifica.')).toBeVisible();
    await expect(agentPage.getByLabel('Răspuns către utilizator')).toHaveCount(0);
    await expect(agentPage.getByRole('button', { name: 'Preia solicitarea' })).toHaveCount(0);
    await expect(agentPage.getByLabel('Notă nouă')).toHaveCount(0);
    await shot(agentPage, 'a3a-agent-escalated', name());

    // The client sees no difference.
    await page.reload();
    await expect(page.locator('main').getByText('Primită', { exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Posibil acces neautorizat');

    // The admin: the escalated ones, answer, give back.
    const adminPage = await newPage(browser);
    await signIn(adminPage, SEED.admin, SEED_PASSWORD);
    await expect(adminPage).toHaveURL(/\/admin\//);
    await adminPage.goto('/admin/suport/solicitari?responsabil=escalated');
    await expect(h1(adminPage)).toHaveText('Solicitări');
    await expectNoHorizontalScroll(adminPage);
    await shot(adminPage, 'a3a-admin-escalated', name());
    await adminPage.getByRole('link').filter({ hasText: title }).click();
    await expect(adminPage.getByText('Motiv: Posibil acces neautorizat')).toBeVisible();
    await adminPage.getByLabel('Răspuns către utilizator').fill('Am schimbat parola contului. Verifică emailul.');
    await adminPage.getByRole('button', { name: 'Trimite răspunsul' }).click();
    await expect(adminPage.getByText('Am schimbat parola contului. Verifică emailul.')).toBeVisible();
    await adminPage.getByRole('button', { name: 'Returnează echipei' }).click();
    await adminPage.getByLabel('Motiv').fill('Cont verificat');
    await adminPage.getByRole('button', { name: 'Returnează echipei' }).last().click();
    await expect(adminPage.getByText(/^Escaladată de/)).toHaveCount(0);
    await expect(adminPage.getByText(`${agent.displayId} · Maria Pop`).first()).toBeVisible();
    await expectAccessible(adminPage, 'Solicitare (admin)');

    // Given back: the agent works on it again.
    await agentPage.reload();
    await expect(agentPage.getByLabel('Răspuns către utilizator')).toBeVisible();

    // The audit log names both, with their reasons.
    await adminPage.goto('/admin/platforma/jurnal');
    await expect(adminPage.getByText('Solicitare escaladată').first()).toBeVisible();
    await expect(adminPage.getByText('Solicitare returnată').first()).toBeVisible();
    await expect(adminPage.getByText('Cont verificat').first()).toBeVisible();
    await adminPage.close();
    await agentPage.close();
  });
});
