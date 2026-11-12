import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { adminToken, createAgent, rpc, signInAgent } from './agent';
import {
  BACKEND,
  PASSWORD,
  SEED,
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
} from './support';

// A5 — Internal procedures: the admin writes a critical exceptional procedure, approves and publishes
// it (its own draft), confirms „Am citit”, sees who confirmed; a new version asks again; an agent finds
// the procedures in its menu, searches, confirms a critical one, proposes a draft it cannot approve;
// the procedures that fit a request open inside it; a client never reaches them (screen or API).
// 390 / 820 / 1440 px, Romanian and English.

const name = () => test.info().project.name;
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const stamp = () => Math.random().toString(36).slice(2, 8);
const nav = (page: Page) => page.getByRole('navigation', { name: /^(Navigare principală|Main navigation)$/ }).filter({ visible: true });

const content = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  applies_when: 'Când un client raportează situația de test.',
  purpose: 'Situația este tratată la fel de fiecare membru al echipei.',
  steps: ['Verifică solicitarea și contul.', 'Notează faptele în nota internă.', 'Răspunde clientului cu pașii din aplicație.'],
  escalation: 'Escaladează când situația cere o decizie a administratorului.',
  warnings: 'Nu cere parole sau coduri.',
  ...extra,
});

const contentEn = (title: string) => ({
  title,
  applies_when: 'When a client reports the test situation.',
  purpose: 'Every team member handles the situation the same way.',
  steps: ['Check the request and the account.', 'Record the facts in the internal note.', 'Answer the client with the steps in the app.'],
  escalation: 'Escalate when the situation needs an admin decision.',
  warnings: 'Never ask for passwords or codes.',
});

/** A procedure written, approved and published by the admin through the API (as the app does). */
async function publishedProcedure(title: string, settings: Record<string, unknown>, en = true): Promise<string> {
  const token = await adminToken();
  const created = await rpc(token, 'staff_procedure_create', {
    p_procedure: settings,
    p_content_ro: content(title),
    p_content_en: en ? contentEn(`${title} EN`) : null,
    p_request_id: randomUUID(),
  });
  expect(created.ok, JSON.stringify(created.body)).toBe(true);
  const { id, version_id } = created.body as { id: string; version_id: string };
  const approved = await rpc(token, 'admin_procedure_approve', { p_version_id: version_id, p_publish: true, p_request_id: randomUUID() });
  expect(approved.ok, JSON.stringify(approved.body)).toBe(true);
  return id;
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

test.describe('Internal procedures (A5)', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('admin: writes, approves its own draft, confirms reading, a new version asks again; history; RO and EN', async ({ page }) => {
    test.setTimeout(180_000);
    const title = `Procedură e2e ${stamp()}`;
    await signIn(page, SEED.admin, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/admin\//);
    await adminOpen(page, 'Suport', 'Proceduri interne');
    await expect(h1(page)).toHaveText('Proceduri interne');
    // The first content is waiting for approval, never published by itself.
    await expect(page.getByRole('heading', { name: 'În lucru' })).toBeVisible();
    await expect(page.getByText('Necesită aprobare').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'admin procedures');
    await shot(page, 'a5-admin-library', name());

    // A new procedure: settings, the Romanian text, the preview; a script is refused before saving.
    await page.getByRole('link', { name: 'Procedură nouă' }).click();
    await expect(h1(page)).toHaveText('Procedură nouă');
    await page.getByLabel('Categorie', { exact: true }).selectOption({ label: 'Securitate și incidente' });
    await page.getByLabel('Tip', { exact: true }).selectOption({ label: 'Excepțională' });
    await page.getByRole('switch', { name: /^Critică/ }).check();
    await page.getByLabel('Titlu').first().fill(title);
    await page.getByLabel('Când se aplică').first().fill('Când un client raportează un acces <script>x</script> străin.');
    await expect(page.getByText('Fără etichete HTML.').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Creează ciorna' })).toBeDisabled();
    await page.getByLabel('Când se aplică').first().fill('Când un client raportează un acces străin la cont.');
    await page.getByLabel('Scop').first().fill('Accesul străin este oprit cât mai repede.');
    await page.getByLabel('Pași de urmat').first().fill('1. Verifică solicitarea.\n2. Escaladează imediat.');
    await page.getByLabel('Când se escaladează').first().fill('Întotdeauna, imediat după pașii de mai sus.');
    await page.getByLabel('Atenție (opțional)').first().fill('Nu cere parole sau coduri.');
    await expect(page.getByRole('listitem').filter({ hasText: 'Escaladează imediat.' }).first()).toBeVisible(); // the preview
    await page.getByRole('button', { name: 'Creează ciorna' }).click();
    await expect(page).toHaveURL(/\/admin\/suport\/proceduri\/[0-9a-f-]{36}\/editare$/);
    await expect(h1(page)).toHaveText('Editează versiunea 1');
    await expectAccessible(page, 'admin procedure editor');
    await expectNoHorizontalScroll(page);
    await shot(page, 'a5-admin-editor', name());

    // Any admin approves, its own draft included.
    await page.getByRole('button', { name: 'Aprobă și publică' }).click();
    await expect(page).toHaveURL(/\/admin\/suport\/proceduri\/[0-9a-f-]{36}$/);
    await expect(h1(page)).toHaveText(title);
    await expect(page.getByText('Versiunea 1, publicată pe')).toBeVisible();
    // „Am citit”: required, only by the button (opening the page confirmed nothing).
    await expect(page.getByText('Citirea este obligatorie.', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Confirmări de citire' })).toBeVisible();
    await expect(page.getByText('Neconfirmat').first()).toBeVisible();
    await expectAccessible(page, 'admin procedure page');
    await expectNoHorizontalScroll(page);
    await shot(page, 'a5-admin-procedure', name());
    await page.getByRole('button', { name: 'Am citit' }).click();
    await expect(page.getByText('Citire confirmată pentru versiunea 1')).toBeVisible();

    // A change is a new version; once published, reading is asked again.
    await page.getByRole('button', { name: 'Versiune nouă' }).click();
    await expect(h1(page)).toHaveText('Editează versiunea 2');
    await page.getByLabel('Termene (opțional)').first().fill('Escaladarea se face în aceeași zi.');
    await page.getByRole('button', { name: 'Salvează ciorna' }).click();
    await expect(page.getByText('Ciorna a fost salvată.')).toBeVisible();
    await page.getByRole('button', { name: 'Aprobă și publică' }).click();
    await expect(page.getByText('Versiunea 2, publicată pe')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Am citit' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Termene' })).toBeVisible();
    await page.getByText('Istoricul versiunilor').scrollIntoViewIfNeeded();
    const v1 = page.locator('details').filter({ hasText: /^\s*Versiunea 1\b/ }).last();
    await v1.locator('summary').click();
    await expect(v1.getByText('Aprobată de')).toBeVisible();

    // English: the interface in English, the text in Romanian with a note (none written).
    await switchLanguage(page, 'en');
    await expect(page.getByText('This procedure has no English text. The Romanian text is shown.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Steps to follow' }).first()).toBeVisible();
    await shot(page, 'a5-admin-procedure-en', name());
    await switchLanguage(page, 'ro');
  });

  test('agent: Proceduri in its menu, search, „Am citit”, a proposal it cannot approve; the procedures inside a request', async ({ page }) => {
    test.setTimeout(240_000);
    const critical = `Procedură critică ${stamp()}`;
    const forRequests = `Procedură pentru cont ${stamp()}`;
    await publishedProcedure(critical, { category: 'security', kind: 'exceptional', critical: true, support_categories: [] });
    await publishedProcedure(forRequests, { category: 'accounts', kind: 'usual', support_categories: ['account'] });
    const hidden = `Doar pentru administratori ${stamp()}`;
    await publishedProcedure(hidden, { category: 'billing', kind: 'usual', visibility: 'admin', support_categories: [] });
    const client = await createUser('client');
    const request = await rpcAs<{ id: string }>(client, 'create_support_request', {
      p_category: 'account',
      p_title: `Nu pot intra ${stamp()}`,
      p_body: 'Contul nu se deschide după schimbarea parolei.',
      p_booking_ref: null,
      p_request_id: randomUUID(),
    });

    const agent = await createAgent();
    await signInAgent(page, agent);
    await expect(h1(page)).toHaveText('Solicitări');
    await nav(page).getByRole('link', { name: isDesktop(page) ? 'Proceduri interne' : 'Proceduri' }).click();
    await expect(page).toHaveURL(/\/suport\/proceduri$/);
    await expect(h1(page)).toHaveText('Proceduri interne');
    await expect(page.getByRole('heading', { name: 'De confirmat' })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`^${critical}`) }).first()).toBeVisible();
    // Never a procedure for admins, never a draft of someone else.
    await expect(page.getByText(hidden)).toHaveCount(0);
    await expect(page.getByText('Necesită aprobare')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'agent procedures');
    await shot(page, 'a5-agent-library', name());

    // Search as one types (diacritics ignored).
    await page.getByLabel('Caută în proceduri').fill('procedura critica');
    // The results replace the sections.
    await expect(page.getByRole('heading', { name: 'De confirmat' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: new RegExp(`^${critical}`) })).toHaveCount(1);
    await page.getByLabel('Caută în proceduri').fill('zzzqqq');
    await expect(page.getByText('Nu există rezultate pentru „zzzqqq”.')).toBeVisible();
    await page.getByRole('button', { name: 'Șterge căutarea' }).click();

    // „Am citit” on the critical one.
    await page.getByRole('link', { name: new RegExp(`^${critical}`) }).first().click();
    await expect(h1(page)).toHaveText(critical);
    await expect(page.getByRole('heading', { name: 'Pași de urmat' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Confirmări de citire' })).toHaveCount(0);
    await expectAccessible(page, 'agent procedure');
    await shot(page, 'a5-agent-procedure', name());
    await page.getByRole('button', { name: 'Am citit' }).click();
    await expect(page.getByText('Citire confirmată pentru versiunea 1')).toBeVisible();
    // English text where it exists.
    await switchLanguage(page, 'en');
    await expect(h1(page)).toHaveText(`${critical} EN`);
    await expectNoRomanianText(page, 'agent procedure (en)');
    await switchLanguage(page, 'ro');

    // A proposal: a draft for agents, sent for approval; no approval for an agent.
    await page.getByRole('link', { name: 'Proceduri interne' }).filter({ visible: true }).first().click();
    await page.getByRole('link', { name: 'Propune o procedură' }).click();
    await expect(page.getByText('O procedură propusă de un agent este pentru agenți și nu este critică.', { exact: false })).toBeVisible();
    await expect(page.getByRole('switch', { name: /^Critică/ })).toHaveCount(0);
    const proposal = `Propunere ${stamp()}`;
    await page.getByLabel('Titlu').first().fill(proposal);
    await page.getByLabel('Când se aplică').first().fill('Când un service cere schimbarea programului.');
    await page.getByLabel('Scop').first().fill('Programul se schimbă corect din aplicație.');
    await page.getByLabel('Pași de urmat').first().fill('Arată calea Cont, apoi Setări.');
    await page.getByLabel('Când se escaladează').first().fill('Când programul nu se poate salva.');
    await page.getByRole('button', { name: 'Creează ciorna' }).click();
    await expect(h1(page)).toHaveText('Editează versiunea 1');
    await expect(page.getByRole('button', { name: 'Aprobă și publică' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Trimite spre aprobare' }).click();
    await expect(page.getByText('Versiunea a fost trimisă spre aprobare.')).toBeVisible();
    await expect(page.getByText('Trimisă spre aprobare').first()).toBeVisible();
    await expectNoHorizontalScroll(page);

    // The request: its category's procedures, opened in place.
    await page.goto(`/suport/solicitari/${request.id}`);
    await expect(page.getByRole('heading', { name: 'Proceduri relevante' })).toBeVisible();
    const fits = page.locator('details').filter({ hasText: forRequests });
    await fits.locator('summary').click();
    await expect(fits.getByText('Notează faptele în nota internă.')).toBeVisible();
    await expect(page.getByText(critical)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'request with procedures');
    await shot(page, 'a5-request-procedures', name());
    await fits.getByRole('link', { name: 'Deschide procedura' }).click();
    await expect(h1(page)).toHaveText(forRequests);
  });

  test('a client never reaches the procedures, in the app or through the API', async ({ page }) => {
    test.setTimeout(90_000);
    const client = await createUser('client');
    const read = await rpcAs(client, 'staff_procedures', {}).then(
      () => 'ok',
      (e: unknown) => String(e),
    );
    expect(read).toMatch(/not_allowed/);
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    for (const path of ['/suport/proceduri', '/admin/suport/proceduri']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/c\//);
      await expect(page.getByText('Proceduri interne')).toHaveCount(0);
    }
  });
});
