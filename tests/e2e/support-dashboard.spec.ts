import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { adminToken, appToken, authJson, createAgent, newPage, rpc, signInAgent, type Agent } from './agent';
import {
  BACKEND,
  PASSWORD,
  SEED,
  SEED_PASSWORD,
  createUser,
  expectAccessible,
  expectNoHorizontalScroll,
  expectNoRomanianText,
  inboxRow,
  rpcAs,
  serviceRest,
  shot,
  signIn,
  switchLanguage,
  userIdOf,
} from './support';

// A3c1 — the support dashboard and live updates: the counters (each opens the list with its filter),
// the warnings at 24 and 48 hours, the oldest request without an answer, the list one page at a time
// over more than 1,000 requests, and everything live — for the team (list, counters, a request) and
// for the author (its own requests), while nobody else hears anything and the author never hears the
// team's internal work. Every screen at 390 / 820 / 1440 px, in Romanian and English.

const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const name = () => test.info().project.name;
const desktop = () => name().startsWith('desktop');
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const stamp = () => Math.random().toString(36).slice(2, 8);
const counters = (page: Page) =>
  page.getByRole('region', {
    name: /^(Situația solicitărilor|Requests at a glance)$/,
  });
const tile = (page: Page, label: string) =>
  counters(page)
    .getByRole('link')
    .filter({ hasText: new RegExp(`^\\s*[\\d.,]+\\s*${label}\\s*$`) });
const tileNumber = async (page: Page, label: string) => Number((await tile(page, label).locator('span').first().innerText()).replace(/[^\d]/g, ''));

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

const passwordToken = async (email: string) =>
  (await authJson<{ access_token: string }>('token?grant_type=password', null, { email, password: PASSWORD })).access_token;

interface Heard {
  type: string;
  suggestion_id?: string;
  audience?: string;
  author_id?: string | null;
  errors?: unknown;
}

/** Listens to support_signals the way the app does, with someone's token; answers what it hears. */
async function listen(token: string, filter?: string) {
  // The token is the subscriber's (as in the app after sign-in), for the database and for Realtime.
  const client = createClient(API, ANON_KEY, {
    accessToken: async () => token,
  });
  // Before joining: otherwise the first join may leave with the public key (as nobody).
  await client.realtime.setAuth(token);
  const heard: Heard[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime did not start')), 20_000);
    client
      .channel(`probe-${randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'support_signals',
          ...(filter ? { filter } : {}),
        },
        (p) =>
          heard.push({
            type: p.eventType,
            ...(p.new as object),
            ...(p.errors ? { errors: p.errors } : {}),
          }),
      )
      .on('system', {}, (m: { extension?: string; status?: string }) => {
        if (m.extension === 'postgres_changes' && m.status === 'ok') {
          clearTimeout(timer);
          resolve();
        }
      })
      .subscribe();
  });
  return { heard, close: () => client.removeAllChannels() };
}

/** A new request written by `email` through the API; answers its id. */
async function request(email: string, title: string, category = 'technical') {
  const r = await rpcAs<{ id: string }>(email, 'create_support_request', {
    p_category: category,
    p_title: title,
    p_body: `Descriere ${title}`,
    p_booking_ref: null,
    p_request_id: randomUUID(),
  });
  return r.id;
}

test.describe('support dashboard (A3c1)', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  let agent: Agent;
  test.beforeAll(async () => {
    agent = await createAgent();
  });

  test('counters open the list with their filter, the warnings and the oldest request match the database, only the team sees them', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const client = await createUser('client');
    const id = await userIdOf(client);
    const s = stamp();
    // Two requests waiting for an answer for 30 and 50 hours.
    await request(client, `Așteaptă de ieri ${s}`);
    const old = await request(client, `Așteaptă de două zile ${s}`);
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    await serviceRest(`suggestions?author_id=eq.${id}&title=eq.${encodeURIComponent(`Așteaptă de ieri ${s}`)}`, 'PATCH', {
      created_at: ago(30),
      last_user_message_at: ago(30),
    });
    await serviceRest(`suggestions?id=eq.${old}`, 'PATCH', {
      created_at: ago(50),
      last_user_message_at: ago(50),
    });

    await signInAgent(page, agent);
    await expect(h1(page)).toHaveText('Solicitări');
    await expect(counters(page)).toBeVisible();
    const token = await appToken(page);
    const db = (await rpc(token, 'support_dashboard', {})).body as {
      counts: Record<string, number>;
      oldest: { title: string };
    };
    for (const [label, key] of [
      ['Noi', 'new'],
      ['În lucru', 'in_progress'],
      ['Așteaptă utilizatorul', 'waiting_user'],
      ['Escaladate', 'escalated'],
      ['Fără responsabil', 'unassigned'],
      ['Ale mele', 'mine'],
      ['Fără răspuns peste 24 h', 'over_24'],
      ['Fără răspuns peste 48 h', 'over_48'],
      ['Rezolvate', 'resolved'],
      ['Închise', 'closed'],
    ] as const) {
      // Other tests write requests at the same time: the number on screen is the database's, give or take theirs.
      expect(Math.abs((await tileNumber(page, label)) - db.counts[key]), label).toBeLessThanOrEqual(3);
    }
    expect(await tileNumber(page, 'Fără răspuns peste 48 h')).toBeGreaterThanOrEqual(1);
    const oldest = page.getByText('Cea mai veche fără răspuns').locator('..');
    await expect(oldest.getByRole('link')).toHaveText(db.oldest.title);
    await expect(oldest).toContainText(/Fără răspuns de \d+ (h|zile)/);
    await expectNoHorizontalScroll(page);
    await shot(page, 'a3c1-dashboard', name());

    // A counter opens the list with its filter, marked as the current one.
    await tile(page, 'Fără răspuns peste 48 h').click();
    await expect(page).toHaveURL(/\?vechime=48$/);
    await expect(tile(page, 'Fără răspuns peste 48 h')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByLabel('Fără răspuns')).toHaveValue('48');
    const row = inboxRow(page, `Așteaptă de două zile ${s}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(/Fără răspuns de [23] zile/);
    await expect(inboxRow(page, `Așteaptă de ieri ${s}`)).toHaveCount(0);
    await tile(page, 'Fără răspuns peste 24 h').click();
    await expect(page).toHaveURL(/\?vechime=24$/);
    await expect(inboxRow(page, `Așteaptă de ieri ${s}`)).toContainText('Fără răspuns de 30 h');
    await tile(page, 'Fără responsabil').click();
    await expect(page).toHaveURL(/\?responsabil=none$/);
    await expect(page.getByLabel('Responsabil')).toHaveValue('none');
    await expectAccessible(page, 'support dashboard');

    await switchLanguage(page, 'en');
    await expect(h1(page)).toHaveText('Requests');
    await expect(tile(page, 'Unassigned')).toHaveAttribute('aria-current', 'true');
    await expect(counters(page)).toContainText('No answer over 48 h');
    await expectNoRomanianText(page, 'support dashboard (EN)');
    await expectNoHorizontalScroll(page);
    await shot(page, 'a3c1-dashboard-en', name());
    await switchLanguage(page, 'ro');

    // The admin: the same counters, and Suport in its Panou opening the list with a filter.
    const admin = await newPage(browser);
    await signIn(admin, SEED.admin, SEED_PASSWORD);
    await expect(admin).toHaveURL(/\/admin\//);
    await admin.goto('/admin/panou');
    const section = admin.getByRole('heading', { name: 'Suport' });
    await expect(section).toBeVisible({ timeout: 20_000 });
    await admin
      .getByRole('link')
      .filter({ hasText: /^\s*[\d.]+\s*Fără răspuns peste 48 h\s*$/ })
      .click();
    await expect(admin).toHaveURL(/\/admin\/suport\/solicitari\?vechime=48$/);
    await expect(counters(admin)).toBeVisible();
    await shot(admin, 'a3c1-admin-panel', name());
    await admin.context().close();

    // Nobody else: a client, a shop, an agent without the second step.
    for (const who of [client, await createUser('shop')]) {
      const t = await passwordToken(who);
      for (const fn of ['support_dashboard', 'support_inbox']) {
        const res = await rpc(t, fn, {});
        expect(res.ok, `${who} ${fn}`).toBe(false);
        expect(JSON.stringify(res.body)).toContain('not_allowed');
      }
    }
    const aal1 = await passwordToken(agent.email);
    expect(JSON.stringify((await rpc(aal1, 'support_dashboard', {})).body)).toContain('mfa_required');
    const other = await newPage(browser);
    await signIn(other, client, PASSWORD);
    await expect(other).toHaveURL(/\/c\//);
    await other.goto('/suport/solicitari');
    await expect(other).toHaveURL(/\/c\//);
    await expect(counters(other)).toHaveCount(0);
    await other.context().close();
  });

  test('more than 1,000 requests: counted whole, listed 30 at a time, each once and in order', async ({ page }) => {
    test.skip(!desktop(), 'one width is enough for the volume');
    test.setTimeout(240_000);
    // A second agent responsible for 1,100 open requests (more than the 1,000 the A3a list read).
    const bulkAgent = await createAgent();
    const agentId = await userIdOf(bulkAgent.email);
    const author = await userIdOf(await createUser('client'));
    const s = stamp();
    const now = Date.now();
    const rows = Array.from({ length: 1100 }, (_, i) => ({
      author_id: author,
      author_role: 'client',
      title: `Volum ${s} ${String(i + 1).padStart(4, '0')}`,
      body: 'Text',
      category: 'vehicles',
      status: 'in_progress',
      assigned_to: agentId,
      // newest first: 0001 is the latest; some share a moment (the id decides)
      created_at: new Date(now - 3_600_000 - Math.floor(i / 2) * 60_000).toISOString(),
      last_user_message_at: new Date(now - 3_600_000 - Math.floor(i / 2) * 60_000).toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 550) await serviceRest('suggestions', 'POST', rows.slice(i, i + 550));

    try {
      const started = Date.now();
      await signInAgent(page, bulkAgent);
      await expect(h1(page)).toHaveText('Solicitări');
      await expect(counters(page)).toBeVisible();
      await expect.poll(() => tileNumber(page, 'Ale mele')).toBe(1100);
      await expect(tile(page, 'Ale mele')).toContainText('1.100');
      expect(Date.now() - started, 'signed in and counted in under 20 s').toBeLessThan(20_000);

      await tile(page, 'Ale mele').click();
      await expect(page).toHaveURL(/\?responsabil=mine$/);
      const titles = () => page.getByRole('list').last().getByRole('link').allInnerTexts();
      await expect(inboxRow(page, `Volum ${s}`)).toHaveCount(30);
      for (const shown of [60, 90]) {
        const t0 = Date.now();
        await page.getByRole('button', { name: 'Arată mai multe' }).click();
        await expect(inboxRow(page, `Volum ${s}`)).toHaveCount(shown);
        expect(Date.now() - t0, 'a page in under 3 s').toBeLessThan(3_000);
      }
      const numbers = (await titles()).map((x) => Number(/Volum \w+ (\d{4})/.exec(x)?.[1] ?? 0)).filter(Boolean);
      expect(numbers.length).toBe(90);
      expect(new Set(numbers).size, 'none twice').toBe(90);
      // Pairs share a moment: inside a pair the id decides, so only the moments must not go back.
      const moments = numbers.map((n) => Math.floor((n - 1) / 2));
      expect(moments).toEqual([...moments].sort((a, b) => a - b));
      await expectNoHorizontalScroll(page);
      await shot(page, 'a3c1-pages', name());

      // The whole list through the API, 100 at a time: every one once.
      const token = await appToken(page);
      const seen = new Set<string>();
      type Cursor = { open: boolean; at: string; id: string } | null;
      let next: Cursor = null;
      let pages = 0;
      do {
        const res = await rpc(token, 'support_inbox', {
          p_owner: 'mine',
          p_status: 'all',
          p_limit: 100,
          ...(next
            ? {
                p_after_open: next.open,
                p_after_at: next.at,
                p_after_id: next.id,
              }
            : {}),
        });
        expect(res.ok, JSON.stringify(res.body)).toBe(true);
        const body = res.body as { items: { id: string }[]; next: Cursor };
        for (const r of body.items) {
          expect(seen.has(r.id)).toBe(false);
          seen.add(r.id);
        }
        next = body.next;
        pages += 1;
      } while (next && pages < 50);
      expect(seen.size).toBe(1100);
      expect(pages).toBe(11);
    } finally {
      await serviceRest(`suggestions?author_id=eq.${author}`, 'DELETE');
    }
  });

  test('live: the team sees a new request and an answer at once, the author sees the team’s answer; nobody else hears anything', async ({
    page,
    browser,
  }) => {
    test.skip(!desktop(), 'the live updates do not depend on the width');
    test.setTimeout(240_000);
    const clientA = await createUser('client');
    const clientB = await createUser('client');
    const idA = await userIdOf(clientA);
    const s = stamp();

    // Who listens: the author (its own rows), another client (everything it may), the team.
    const first = await request(clientA, `Prima ${s}`);
    const hearA = await listen(await passwordToken(clientA));
    const hearB = await listen(await passwordToken(clientB));
    const hearShop = await listen(await passwordToken(await createUser('shop')));
    const hearAal1 = await listen(await passwordToken(agent.email));
    // Signed out: Realtime tells a listener without rights only that something changed, never what.
    const hearNobody = await listen(ANON_KEY);

    await signInAgent(page, agent);
    await expect(h1(page)).toHaveText('Solicitări');
    await expect(counters(page)).toBeVisible();
    const hearTeam = await listen(await appToken(page));
    const newBefore = await tileNumber(page, 'Noi');

    // A new request appears in the team's list and counters without reloading.
    const live = await request(clientA, `Live ${s}`);
    await expect(inboxRow(page, `Live ${s}`)).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => tileNumber(page, 'Noi'), { timeout: 15_000 }).toBeGreaterThan(newBefore);

    // The author has the request open; the agent takes it, notes, answers.
    const author = await newPage(browser);
    await signIn(author, clientA, PASSWORD);
    await expect(author).toHaveURL(/\/c\//);
    await author.goto(`/c/cont/ajutor/solicitari/${live}`);
    await expect(h1(author)).toHaveText(`Live ${s}`);

    await page
      .getByRole('link')
      .filter({ hasText: `Live ${s}` })
      .click();
    await expect(h1(page)).toHaveText(`Live ${s}`);
    const token = await appToken(page);
    const before = hearA.heard.length;
    expect(
      (
        await rpc(token, 'support_take_request', {
          p_id: live,
          p_request_id: randomUUID(),
        })
      ).ok,
    ).toBe(true);
    await expect.poll(() => hearA.heard.length, { timeout: 15_000 }).toBeGreaterThan(before); // „În lucru”: the author sees it
    await expect(author.getByText('În lucru').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(1_500); // the take's signals have all arrived
    const afterTake = hearA.heard.length;
    const teamBeforeNote = hearTeam.heard.length;
    expect(
      (
        await rpc(token, 'support_add_note', {
          p_id: live,
          p_body: `Notă internă ${s}`,
          p_request_id: randomUUID(),
        })
      ).ok,
    ).toBe(true);
    await expect.poll(() => hearTeam.heard.length, { timeout: 15_000 }).toBeGreaterThan(teamBeforeNote);
    await page.waitForTimeout(2_000);
    expect(hearA.heard.length, 'a note: the author hears nothing').toBe(afterTake);
    expect(
      (
        await rpc(token, 'support_reply_request', {
          p_id: live,
          p_body: `Răspuns live ${s}`,
          p_status: null,
          p_request_id: randomUUID(),
        })
      ).ok,
    ).toBe(true);
    // The author's page shows the answer without reloading, signed by the team; never the note.
    await expect(author.getByText(`Răspuns live ${s}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(author.getByText('Echipa Service-Hub').first()).toBeVisible();
    await expect(author.getByText(`Notă internă ${s}`)).toHaveCount(0);
    await shot(author, 'a3c1-author-live', name());

    // The author answers: the agent's open request shows it without reloading.
    await author.getByLabel('Mesajul tău').fill(`Mulțumesc ${s}`);
    await author.getByRole('button', { name: 'Trimite mesajul' }).click();
    await expect(page.getByText(`Mulțumesc ${s}`)).toBeVisible({
      timeout: 15_000,
    });
    await author.context().close();

    // The second client writes too (a positive control for its own listener).
    const theirs = await request(clientB, `A lui B ${s}`);
    await expect.poll(() => hearB.heard.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(3_000); // anything late would have arrived

    // The author heard only its own requests, only its own rows, and nothing from the note alone.
    expect(hearA.heard.every((h) => h.audience === 'author' && h.author_id === idA && [first, live].includes(h.suggestion_id ?? ''))).toBe(true);
    expect(hearA.heard.some((h) => h.suggestion_id === theirs)).toBe(false);
    // Another client heard only its own; a shop and an agent without the second step nothing.
    expect(hearB.heard.every((h) => h.suggestion_id === theirs && h.audience === 'author')).toBe(true);
    expect(hearShop.heard).toEqual([]);
    expect(hearAal1.heard).toEqual([]);
    // The team heard every request, never an author's row, and no signal carries any text.
    expect(hearTeam.heard.some((h) => h.suggestion_id === theirs)).toBe(true);
    expect(hearTeam.heard.every((h) => h.audience === 'team' && h.author_id === null)).toBe(true);
    for (const h of [...hearA.heard, ...hearTeam.heard]) {
      expect(Object.keys(h).sort()).toEqual(['audience', 'author_id', 'changed_at', 'id', 'suggestion_id', 'type']);
    }
    expect(
      hearNobody.heard.every((h) => h.errors && !h.suggestion_id && !h.author_id),
      'signed out: never an id',
    ).toBe(true);
    for (const h of [...hearA.heard, ...hearB.heard, ...hearTeam.heard]) expect(h.errors).toBeUndefined();
    for (const l of [hearA, hearB, hearShop, hearAal1, hearTeam, hearNobody]) await l.close();

    // The admin's list is live too, and withdrawing the agent's role ends what it hears.
    const admin = await adminToken();
    const hearOld = await listen(token);
    expect(
      (
        await rpc(admin, 'admin_revoke_support', {
          p_user_id: await userIdOf(agent.email),
          p_reason: 'Test A3c1',
          p_request_id: randomUUID(),
        })
      ).ok,
    ).toBe(true);
    const after = await request(clientA, `După retragere ${s}`);
    await page.waitForTimeout(4_000);
    // Only what happens after the withdrawal counts: a change made before it may still arrive late
    // on a busy test database (A6: seen with the fleet-files test running alongside).
    expect(
      hearOld.heard.filter((h) => h.suggestion_id === after),
      'a withdrawn agent hears nothing more',
    ).toEqual([]);
    await hearOld.close();
    agent = await createAgent();
  });
});
