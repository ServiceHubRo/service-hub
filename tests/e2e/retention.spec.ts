import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { adminToken, createAgent, newPage, rpc, signInAgent, type Agent } from './agent';
import {
  BACKEND,
  SEED,
  SEED_PASSWORD,
  adminOpen,
  createUser,
  expectAccessible,
  expectNoHorizontalScroll,
  expectNoRomanianText,
  serviceRest,
  shot,
  signIn,
  switchLanguage,
  userIdOf,
} from './support';

// A3c2b1 — retention of support data: the admin previews each job (exact numbers, the legal hold
// exceptions apart, nothing changed), switches one on only with those numbers (a reason required; numbers
// that changed meanwhile are refused and shown again) and off again; the suggestions past 12 months wait
// for an agent or the admin to confirm, edit or delete their text. 390 / 820 / 1440 px, RO and EN.
// The jobs never run on their own here (their schedule is at night): a run is started through the
// service key, as the scheduler would, and every job is switched off again at the end.

const name = () => test.info().project.name;
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const stamp = () => Math.random().toString(36).slice(2, 8);
const monthsAgo = (n: number) => new Date(Date.now() - n * 31 * 86_400_000).toISOString();

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

/** A request whose last real activity was 13 months ago (inserted as the past would have left it). */
async function oldRequest(author: string, category: string, title: string | null, body: string) {
  const id = await userIdOf(author);
  const [row] = await serviceRest<{ id: string }[]>('suggestions', 'POST', {
    author_id: id,
    author_role: 'client',
    title,
    body,
    category,
    status: category === 'suggestions' ? 'planned' : 'closed',
    created_at: monthsAgo(14),
    closed_at: category === 'suggestions' ? null : monthsAgo(13),
    last_user_message_at: monthsAgo(14),
    last_activity_at: monthsAgo(13),
  });
  return row!.id;
}

/** The admin switches a job on with the numbers it previews now (retried when others changed them). */
async function switchOn(token: string, job: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const preview = await rpc(token, 'admin_retention_preview', { p_job: job });
    const res = await rpc(token, 'admin_set_retention_job', {
      p_job: job,
      p_enabled: true,
      p_reason: 'Test automat al retenției, pe date de test',
      p_batch_size: 500,
      p_expected: (preview.body as { counts: unknown }).counts,
      p_request_id: randomUUID(),
    });
    if (res.ok) return;
  }
  throw new Error(`${job} could not be switched on`);
}

async function switchOff(token: string, job: string) {
  await rpc(token, 'admin_set_retention_job', {
    p_job: job,
    p_enabled: false,
    p_reason: 'Sfârșitul testului automat',
    p_batch_size: null,
    p_expected: null,
    p_request_id: randomUUID(),
  });
}

/** The scheduler's run, until the given suggestions have left (another test may switch the job off). */
async function anonymize(token: string, ids: string[]) {
  for (let attempt = 0; attempt < 10; attempt++) {
    await switchOn(token, 'suggestions');
    await serviceRest('rpc/run_suggestion_anonymization', 'POST', {});
    const left = await serviceRest<unknown[]>(`suggestions?id=in.(${ids.join(',')})&select=id`, 'GET');
    if (left.length === 0) return;
  }
  throw new Error('the suggestions were not moved to the check');
}

test.describe('retention (A3c2b1)', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('the admin previews the jobs; on a wide screen switches the requests job on with its numbers and off again', async ({ page }) => {
    test.setTimeout(180_000);
    const s = stamp();
    const client = await createUser('client');
    await oldRequest(client, 'technical', `Veche ${s}`, `Descriere ${s}`);

    await signIn(page, SEED.admin, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/admin\//);
    await adminOpen(page, 'Platformă', 'Retenția datelor');
    await expect(h1(page)).toHaveText('Retenția datelor');
    const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Solicitări de suport' }) });
    const suggestions = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Sugestii', exact: true }) });
    await expect(card).toBeVisible();
    await expect(suggestions).toBeVisible();

    // The preview: what would be processed, the exceptions apart.
    await card.getByRole('button', { name: 'Previzualizează' }).click();
    await expect(card.getByText('Se procesează')).toBeVisible();
    await expect(card.getByText('Exceptate')).toBeVisible();
    await expect(card.getByText('Sub păstrare legală')).toBeVisible();
    await suggestions.getByRole('button', { name: 'Previzualizează' }).click();
    await expect(suggestions.getByText('Date găsite în texte')).toBeVisible();
    // A3c2b2: the log jobs; the administrative one is locked until the legal validation.
    const supportLog = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Jurnalul echipei de suport' }) });
    const adminLog = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Jurnalul administrativ' }) });
    await expect(adminLog.getByText('Blocat', { exact: true })).toBeVisible();
    await expect(adminLog.getByText('Termenul de 3 ani așteaptă validarea juridică.', { exact: false })).toBeVisible();
    await adminLog.getByRole('button', { name: 'Previzualizează' }).click();
    await expect(adminLog.getByText('Înregistrări de șters')).toBeVisible();
    await expect(adminLog.getByRole('button', { name: 'Activează', exact: true })).toHaveCount(0);
    await supportLog.getByRole('button', { name: 'Previzualizează' }).click();
    await expect(supportLog.getByText('Căutări din care se șterg cuvintele')).toBeVisible();
    await expect(supportLog.getByText('Scrise înainte de această etapă (neatinse)')).toBeVisible();

    // The report on the log: numbers only.
    await page.getByRole('button', { name: 'Generează raportul' }).click();
    await expect(page.getByText(/^Înregistrări în jurnal: /)).toBeVisible();
    await expect(page.getByText('Cu cuvinte căutate', { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'retention');
    await shot(page, 'a3c2b1-retention-preview', name());

    await switchLanguage(page, 'en');
    await expect(h1(page)).toHaveText('Data retention');
    await expectNoRomanianText(page, 'retention (EN)');
    await expectNoHorizontalScroll(page);
    await shot(page, 'a3c2b1-retention-en', name());
    await switchLanguage(page, 'ro');
    await expect(h1(page)).toHaveText('Retenția datelor');

    // The switch itself changes a state shared by every test: one screen size does it.
    if (name() !== 'desktop-1440') return;
    const token = await adminToken();
    await switchOff(token, 'support_requests');
    await page.reload();
    await card.getByRole('button', { name: 'Previzualizează' }).click();
    await card.getByRole('button', { name: 'Activează', exact: true }).click();
    await expect(card.getByText('Activezi jobul?')).toBeVisible();
    await card.getByRole('button', { name: 'Activează cu aceste numere' }).click();
    await expect(card.getByText('Scrie un motiv de cel puțin 10 caractere.')).toBeVisible();
    await card.getByLabel('Motivul activării').fill('Activare de test după verificarea numerelor');
    await shot(page, 'a3c2b1-retention-enable', name());

    // The numbers change after the preview: refused, shown again.
    await oldRequest(client, 'technical', `Încă una ${s}`, `Descriere ${s}`);
    await card.getByRole('button', { name: 'Activează cu aceste numere' }).click();
    await expect(card.getByRole('status').filter({ hasText: 'Numerele s-au schimbat de la previzualizare.' })).toBeVisible();
    await expect(card.getByText('Oprit', { exact: true })).toBeVisible();

    // With the numbers as they are now (others may change them meanwhile: tried again).
    for (let attempt = 0; attempt < 5; attempt++) {
      await card.getByRole('button', { name: 'Activează', exact: true }).click();
      await card.getByLabel('Motivul activării').fill('Activare de test după verificarea numerelor');
      await card.getByRole('button', { name: 'Activează cu aceste numere' }).click();
      const done = card.getByRole('status').filter({ hasText: 'Jobul a fost activat.' });
      if (await done.waitFor({ timeout: 8_000 }).then(() => true, () => false)) break;
    }
    await expect(card.getByText('Activ', { exact: true })).toBeVisible();
    await expect(card.getByText(/Activat de .*Motiv: Activare de test/)).toBeVisible();
    await shot(page, 'a3c2b1-retention-on', name());

    await card.getByRole('button', { name: 'Oprește jobul' }).click();
    await card.getByLabel('Motivul opririi').fill('Oprire după testul automat');
    await card.getByRole('button', { name: 'Oprește jobul' }).last().click();
    await expect(card.getByRole('status').filter({ hasText: 'Jobul a fost oprit.' })).toBeVisible();
    await expect(card.getByText('Oprit', { exact: true })).toBeVisible();
    await expect(card.getByText(/Oprit de .*Motiv: Oprire după testul automat/)).toBeVisible();

    // Every switch is in the audit log, with its reason.
    await adminOpen(page, 'Platformă', 'Jurnal de audit');
    await expect(page.getByText('Job de retenție modificat').first()).toBeVisible();
  });

  test('an agent and the admin check the texts of suggestions past 12 months', async ({ page, browser }) => {
    test.setTimeout(300_000);
    const s = stamp();
    const client = await createUser('client');
    const toEdit = await oldRequest(client, 'suggestions', null, `Sugestia-A ${s}: sunați-mă la 0722 123 456 sau la ana.${s}@gmail.com`);
    const toConfirm = await oldRequest(client, 'suggestions', null, `Sugestia-B ${s}: un filtru pentru B 123 ABC`);
    const toDelete = await oldRequest(client, 'suggestions', null, `Sugestia-C ${s} de la Ion Popescu`);
    const token = await adminToken();
    try {
      await anonymize(token, [toEdit, toConfirm, toDelete]);
    } finally {
      await switchOff(token, 'suggestions');
    }

    // The agent: from Solicitări to the check.
    const agent: Agent = await createAgent();
    const agentPage = await newPage(browser);
    await signInAgent(agentPage, agent);
    await expect(h1(agentPage)).toHaveText('Solicitări');
    await agentPage.getByRole('link', { name: /^Sugestii de verificat: / }).click();
    await expect(h1(agentPage)).toHaveText('Sugestii de verificat');
    const card = agentPage.getByRole('listitem').filter({ hasText: `Sugestia-A ${s}` });
    await expect(card).toContainText('Date găsite: email (1), telefon (1)');
    await expect(card).toContainText(`Sugestia-A ${s}: sunați-mă la [telefon] sau la [email]`);
    await expect(card).toContainText(/Zile până la ștergerea textului: (29|30)/);
    await expectNoHorizontalScroll(agentPage);
    await expectAccessible(agentPage, 'text reviews');
    await shot(agentPage, 'a3c2b1-reviews', name());

    // An edit that still identifies somebody is refused; a clean one is kept.
    await card.getByRole('button', { name: 'Editează textul' }).click();
    await card.getByLabel('Textul păstrat').fill(`Sugestia-A ${s}: scrieți-mi la ion@example.com`);
    await card.getByRole('button', { name: 'Salvează textul' }).click();
    await expect(card.getByText(/Textul conține încă date care pot identifica o persoană/)).toBeVisible();
    await shot(agentPage, 'a3c2b1-reviews-refused', name());
    await card.getByLabel('Textul păstrat').fill(`Sugestia-A ${s}: contact direct cu echipa`);
    await card.getByRole('button', { name: 'Salvează textul' }).click();
    await expect(agentPage.getByRole('status').filter({ hasText: 'Textul a fost salvat.' })).toBeVisible();
    await expect(agentPage.getByRole('listitem').filter({ hasText: `Sugestia-A ${s}` })).toHaveCount(0);
    await agentPage.getByRole('combobox', { name: 'Afișează' }).selectOption('kept');
    await expect(agentPage.getByText(`Sugestia-A ${s}: contact direct cu echipa`)).toBeVisible();

    await switchLanguage(agentPage, 'en');
    await expect(h1(agentPage)).toHaveText('Suggestions to check');
    await expectNoRomanianText(agentPage, 'text reviews (EN)');
    await expectNoHorizontalScroll(agentPage);
    await shot(agentPage, 'a3c2b1-reviews-kept-en', name());
    await agentPage.close();

    // The admin: Suport → Sugestii de verificat; confirms one, deletes the other.
    await signIn(page, SEED.admin, SEED_PASSWORD);
    await adminOpen(page, 'Suport', 'Sugestii de verificat');
    await expect(h1(page)).toHaveText('Sugestii de verificat');
    const confirm = page.getByRole('listitem').filter({ hasText: `Sugestia-B ${s}` });
    await expect(confirm).toContainText(`Sugestia-B ${s}: un filtru pentru [nr. înmatriculare]`);
    await confirm.getByRole('button', { name: 'Confirmă textul propus' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Textul a fost confirmat.' })).toBeVisible();

    const remove = page.getByRole('listitem').filter({ hasText: `Sugestia-C ${s}` });
    await expect(remove).toContainText('Nu au fost găsite date. Verifică numele din text.');
    await remove.getByRole('button', { name: 'Șterge textul' }).click();
    await expect(remove.getByText('Ștergi textul?')).toBeVisible();
    await shot(page, 'a3c2b1-reviews-delete', name());
    await remove.getByRole('button', { name: 'Șterge textul' }).last().click();
    await expect(page.getByRole('status').filter({ hasText: 'Textul a fost șters.' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: `Sugestia-C ${s}` })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});
