import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { JPEG, PNG } from '../unit/fixtures/support-files/images';
import { appToken, createAgent, newPage, signInAgent } from './agent';
import { BACKEND, PASSWORD, SEED, SEED_PASSWORD, createUser, expectAccessible, expectNoHorizontalScroll, serviceRest, shot, signIn, switchLanguage } from './support';

// A3b — files of support requests, end to end with the Edge Function support-files: the real type and
// soundness checked on the server (a text named .png, a broken image, an active PDF and a file over
// 5 MB are refused, each with why); a photo loses its personal metadata and keeps its orientation;
// the team attaches its files the same way; the author and the team open them (each opening in the
// audit log; the admin sees who opened what); nobody else can, not even with the API; the link
// expires; at most 5 files per message; files never sent and files of requests closed 90 days ago
// are deleted from Storage and from the tables.

const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? '';
const name = () => test.info().project.name;
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const stamp = () => Math.random().toString(36).slice(2, 8);
const b = (s: string) => Buffer.from(s, 'latin1');

// ------------------------------------------------------------------ files
const be16 = (n: number) => Buffer.from([(n >> 8) & 255, n & 255]);
const be32 = (n: number) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
/** A phone photo: EXIF with the camera, the owner, a GPS block and orientation 6. */
function phoneJpeg(): Buffer {
  const strings = ['Samsung', 'Ion Popescu'];
  const tags = [0x010f, 0x013b];
  const entries = 4;
  let off = 8 + 2 + entries * 12 + 4;
  const ifd: Buffer[] = [be16(entries)];
  const data: Buffer[] = [];
  strings.forEach((s, k) => {
    const v = b(`${s}\u0000`);
    ifd.push(be16(tags[k]!), be16(2), be32(v.length), be32(off));
    data.push(v);
    off += v.length;
  });
  ifd.push(be16(0x0112), be16(3), be32(1), Buffer.concat([be16(6), be16(0)]));
  const gpsText = b('GPS-LAT-44.4268N\u0000');
  ifd.push(be16(0x8825), be16(4), be32(1), be32(off), be32(0));
  const gps = Buffer.concat([be16(1), be16(2), be16(2), be32(gpsText.length), be32(off + 18), be32(0), gpsText]);
  const tiff = Buffer.concat([b('MM'), be16(42), be32(8), ...ifd, ...data, gps]);
  const payload = Buffer.concat([b('Exif\u0000\u0000'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), be16(payload.length + 2), payload]);
  const base = Buffer.from(JPEG, 'base64');
  return Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)]);
}
const FILES = {
  png: () => ({ name: 'captura-ecran.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') }),
  photo: () => ({ name: 'IMG_2026.jpg', mimeType: 'image/jpeg', buffer: phoneJpeg() }),
  fakePng: () => ({ name: 'poza.png', mimeType: 'image/png', buffer: b('#!/bin/sh\necho not an image\n') }),
  broken: () => ({ name: 'stricata.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64').subarray(0, 60) }),
  activePdf: () => ({
    name: 'factura.pdf',
    mimeType: 'application/pdf',
    buffer: b('%PDF-1.7\n1 0 obj\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'),
  }),
  big: () => ({ name: 'mare.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(6 * 1024 * 1024)]) }),
};

async function upload(token: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.name);
  const res = await fetch(`${API}/functions/v1/support-files`, { method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }, body: form });
  return { status: res.status, body: (await res.json()) as { id?: string; error?: string } };
}
async function openFile(token: string | null, fileId: string) {
  const res = await fetch(`${API}/functions/v1/support-files`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action: 'open', file_id: fileId }),
  });
  return { status: res.status, body: (await res.json()) as { url?: string; error?: string } };
}
async function cleanup() {
  const [config] = await serviceRest<{ dispatch_token: string }[]>('push_config?id=eq.1&select=dispatch_token', 'GET');
  const res = await fetch(`${API}/functions/v1/support-files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-dispatch-token': config!.dispatch_token },
    body: JSON.stringify({ action: 'cleanup' }),
  });
  expect(res.ok, await res.clone().text()).toBe(true);
  return (await res.json()) as { collected: number; removed: number; stray: number };
}
const storedObject = (path: string) =>
  fetch(`${API}/storage/v1/object/support-files/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('sh_test_init')) {
      sessionStorage.setItem('sh_test_init', '1');
      localStorage.setItem('sh_lang', 'ro');
    }
  });
});

test.describe('support files (A3b)', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('checked on the server, cleaned, sent by the author and the team, opened and logged, closed to everyone else', async ({ page, browser }) => {
    test.setTimeout(240_000);
    const client = await createUser('client', { name: 'Ana Fișiere' });
    const stranger = await createUser('client');
    const agent = await createAgent();
    const title = `Captură eroare ${stamp()}`;

    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await page.goto('/c/cont/ajutor/solicitari/noua');
    await page.getByLabel('Categorie').selectOption({ label: 'Probleme tehnice' });
    await page.getByLabel('Titlu').fill(title);
    await page.getByLabel('Descriere').fill('Atașez capturi.');
    const picker = page.locator('input[type="file"]');
    await picker.setInputFiles([FILES.png(), FILES.photo(), FILES.fakePng(), FILES.broken(), FILES.activePdf()]);
    // Each file says what happened to it.
    await expect(page.getByText('Doar fișiere PNG, JPEG, WebP sau PDF.')).toBeVisible();
    await expect(page.getByText('Fișierul este deteriorat sau incomplet.')).toBeVisible();
    await expect(page.getByText('PDF-ul conține cod sau acțiuni automate și nu poate fi trimis.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Elimină captura-ecran.png' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Elimină IMG_2026.jpg' })).toBeVisible();
    await expect(page.getByText('Se încarcă…')).toHaveCount(0);
    await picker.setInputFiles([FILES.big()]);
    await expect(page.getByText('Fișierul depășește 5 MB.')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, 'Solicitare nouă cu fișiere');
    await shot(page, 'a3b-new-with-files', name());
    await page.getByRole('button', { name: 'Trimite solicitarea' }).click();
    await expect(h1(page)).toHaveText(title);
    const files = page.getByRole('list', { name: 'Fișiere atașate' });
    await expect(files.getByText('captura-ecran.png')).toBeVisible();
    await expect(files.getByText('IMG_2026.jpg')).toBeVisible();
    await expect(files.getByText('poza.png')).toHaveCount(0);
    await shot(page, 'a3b-request-files', name());

    // The author opens the photo: a new tab with a signed link; the stored copy has no metadata left.
    const [tab] = await Promise.all([page.waitForEvent('popup'), files.getByRole('listitem').filter({ hasText: 'IMG_2026.jpg' }).getByRole('button', { name: 'Deschide' }).click()]);
    await tab.waitForURL(/\/storage\/v1\/object\/sign\/support-files\//);
    const stored = Buffer.from(await (await fetch(tab.url())).arrayBuffer());
    await tab.close();
    expect(stored.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    for (const leak of ['Samsung', 'Ion Popescu', 'GPS-LAT']) expect(stored.includes(b(leak)), leak).toBe(false);
    expect(stored.includes(b('Exif\u0000\u0000'))).toBe(true); // the orientation, alone

    // Nobody else, not even through the API or Storage directly.
    const [row] = await serviceRest<{ id: string; path: string }[]>(
      `suggestion_files?select=id,path&name=eq.IMG_2026.jpg&order=created_at.desc&limit=1`,
      'GET',
    );
    const strangerToken = (await (await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: stranger, password: PASSWORD }),
    })).json() as { access_token: string }).access_token;
    expect(await openFile(strangerToken, row!.id)).toEqual({ status: 404, body: { error: 'file_not_found' } });
    expect((await openFile(null, row!.id)).status).toBe(401);
    for (const url of [`object/support-files/${row!.path}`, `object/public/support-files/${row!.path}`, `object/authenticated/support-files/${row!.path}`]) {
      const res = await fetch(`${API}/storage/v1/${url}`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${await appToken(page)}` } });
      expect(res.ok, url).toBe(false);
    }
    const list = await fetch(`${API}/storage/v1/object/list/support-files`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${await appToken(page)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '' }),
    });
    expect(await list.json()).toEqual([]);
    const tableRead = await fetch(`${API}/rest/v1/suggestion_files?select=path`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${await appToken(page)}` } });
    expect(tableRead.ok).toBe(false);

    // The team: the agent sees both files and answers with its own, checked the same way.
    const agentPage = await newPage(browser);
    await signInAgent(agentPage, agent);
    await agentPage.getByRole('link').filter({ hasText: title }).click();
    await expect(agentPage.getByText('IMG_2026.jpg')).toBeVisible();
    await agentPage.getByLabel('Răspuns către utilizator').fill('Urmează pașii din captură.');
    const teamPicker = agentPage.locator('input[type="file"]');
    await teamPicker.setInputFiles([FILES.activePdf(), { ...FILES.png(), name: 'pasi.png' }]);
    await expect(agentPage.getByText('PDF-ul conține cod sau acțiuni automate și nu poate fi trimis.')).toBeVisible();
    await expect(agentPage.getByRole('button', { name: 'Elimină pasi.png' })).toBeVisible();
    await agentPage.getByRole('button', { name: 'Trimite răspunsul' }).click();
    await expect(agentPage.getByRole('list', { name: 'Fișiere atașate' }).getByText('pasi.png')).toBeVisible();
    await expectAccessible(agentPage, 'Solicitare cu fișiere (agent)');
    await shot(agentPage, 'a3b-agent-files', name());
    await agentPage.close();

    await page.reload();
    await expect(page.getByRole('list', { name: 'Fișiere atașate' }).getByText('pasi.png')).toBeVisible();

    // The admin sees who opened each file; every opening is in the audit log.
    const adminPage = await newPage(browser);
    await signIn(adminPage, SEED.admin, SEED_PASSWORD);
    await expect(adminPage).toHaveURL(/\/admin\//);
    await adminPage.goto('/admin/suport/solicitari?stare=all');
    await adminPage.getByRole('link').filter({ hasText: title }).click();
    const photo = adminPage.getByRole('listitem').filter({ hasText: 'IMG_2026.jpg' });
    await expect(photo.getByText(/^Deschis de C-\d{5} · Ana Fișiere/)).toBeVisible();
    await expect(adminPage.getByRole('listitem').filter({ hasText: 'captura-ecran.png' }).getByText('Nedeschis')).toBeVisible();
    await shot(adminPage, 'a3b-admin-opens', name());
    await adminPage.goto('/admin/platforma/jurnal');
    await expect(adminPage.getByText('Fișier deschis').first()).toBeVisible();
    await adminPage.close();

    // English.
    await switchLanguage(page, 'en');
    await page.reload();
    await expect(page.getByRole('list', { name: 'Attached files' }).getByText('IMG_2026.jpg')).toBeVisible();
    await shot(page, 'a3b-request-files-en', name());
    await switchLanguage(page, 'ro');
  });

  test('a link expires after 60 seconds', async () => {
    test.skip(name() !== 'desktop-1440', 'once is enough');
    test.setTimeout(120_000);
    const client = await createUser('client');
    const token = (await (await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: client, password: PASSWORD }),
    })).json() as { access_token: string }).access_token;
    const up = await upload(token, FILES.png());
    expect(up.status).toBe(200);
    const created = await fetch(`${API}/rest/v1/rpc/create_support_request`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_category: 'technical', p_title: 'Link', p_body: 'x', p_booking_ref: '', p_request_id: randomUUID(), p_file_ids: [up.body.id] }),
    });
    expect(created.ok).toBe(true);
    const opened = await openFile(token, up.body.id!);
    expect(opened.status).toBe(200);
    expect((await fetch(`${API}${opened.body.url}`)).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 62_000));
    expect((await fetch(`${API}${opened.body.url}`)).ok).toBe(false);
  });

  test('at most 5 files per message; not sent after 24 hours and closed for 90 days: deleted from Storage and the tables', async ({ page }) => {
    test.skip(name() !== 'desktop-1440', 'the database and Storage behave the same at every width');
    test.setTimeout(120_000);
    const client = await createUser('client');
    await signIn(page, client, PASSWORD);
    await expect(page).toHaveURL(/\/c\/cauta/);
    await page.goto('/c/cont/ajutor/solicitari/noua');
    await page.locator('input[type="file"]').setInputFiles(Array.from({ length: 6 }, (_, k) => ({ ...FILES.png(), name: `ecran-${k + 1}.png` })));
    await expect(page.getByText('Cel mult 5 fișiere la un mesaj.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Elimină ecran-/ })).toHaveCount(5);
    await expect(page.getByText('Se încarcă…')).toHaveCount(0);

    const token = await appToken(page);
    // A file never sent, 25 hours old.
    const pending = await upload(token, { ...FILES.png(), name: 'uitat.png' });
    expect(pending.status).toBe(200);
    // A request closed 91 days ago, with its file.
    const sent = await upload(token, { ...FILES.png(), name: 'vechi.png' });
    const created = (await (await fetch(`${API}/rest/v1/rpc/create_support_request`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_category: 'technical', p_title: 'Veche', p_body: 'x', p_booking_ref: '', p_request_id: randomUUID(), p_file_ids: [sent.body.id] }),
    })).json()) as { id: string };
    const [p1] = await serviceRest<{ path: string }[]>(`suggestion_files?select=path&id=eq.${pending.body.id}`, 'GET');
    const [p2] = await serviceRest<{ path: string }[]>(`suggestion_files?select=path&id=eq.${sent.body.id}`, 'GET');
    expect((await storedObject(p1!.path)).ok).toBe(true);
    expect((await storedObject(p2!.path)).ok).toBe(true);
    await serviceRest(`suggestion_files?id=eq.${pending.body.id}`, 'PATCH', { created_at: new Date(Date.now() - 25 * 3_600_000).toISOString() });
    await serviceRest(`suggestions?id=eq.${created.id}`, 'PATCH', { status: 'closed', closed_at: new Date(Date.now() - 91 * 86_400_000).toISOString() });

    const result = await cleanup();
    expect(result.collected).toBeGreaterThanOrEqual(2);
    expect(await serviceRest<unknown[]>(`suggestion_files?select=id&id=in.(${pending.body.id},${sent.body.id})`, 'GET')).toEqual([]);
    expect(await serviceRest<unknown[]>(`support_file_deletions?select=path&path=in.(${p1!.path},${p2!.path})`, 'GET')).toEqual([]);
    expect((await storedObject(p1!.path)).ok).toBe(false);
    expect((await storedObject(p2!.path)).ok).toBe(false);
    // The request itself stays.
    expect(await serviceRest<unknown[]>(`suggestions?select=id&id=eq.${created.id}`, 'GET')).toHaveLength(1);
    // Without the dispatcher's token, nobody runs the cleanup.
    const refused = await fetch(`${API}/functions/v1/support-files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-dispatch-token': 'wrong' },
      body: JSON.stringify({ action: 'cleanup' }),
    });
    expect(refused.status).toBe(403);
  });
});
