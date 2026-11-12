import { expect, test } from '@playwright/test';
import { JPEG, PNG } from '../unit/fixtures/support-files/images';
import { BACKEND, PASSWORD, createFleetUser, rpcAs, serviceRest, uniquePlate, userIdOf } from './support';

// A6 (M4) — fleet files only through the Edge Function fleet-files, end to end: a real PNG and a PDF
// are stored; a text named .png, a broken image, a PDF with JavaScript, a PDF on a report and a file
// over 5 MB are refused with why; a phone photo is stored without its GPS block (the stored bytes are
// read back); a vehicle of another company is refused; a suspended account is refused; the browser
// can no longer write to the bucket directly.

const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? '';
const b = (s: string) => Buffer.from(s, 'latin1');
const be16 = (n: number) => Buffer.from([(n >> 8) & 255, n & 255]);
const be32 = (n: number) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

/** A phone photo: EXIF with the camera, the owner, a GPS block and orientation 6. */
function phoneJpeg(): Buffer {
  const strings = ['Samsung', 'Ion Popescu'];
  const tags = [0x010f, 0x013b];
  let off = 8 + 2 + 4 * 12 + 4;
  const ifd: Buffer[] = [be16(4)];
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
const PDF = b('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const ACTIVE_PDF = b('%PDF-1.7\n1 0 obj\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');

async function tokenOf(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.ok).toBe(true);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function upload(token: string, fields: { company: string; vehicle: string; issue?: string }, file: { name: string; type: string; bytes: Buffer }) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
  form.append('company', fields.company);
  form.append('vehicle', fields.vehicle);
  if (fields.issue) form.append('issue', fields.issue);
  const res = await fetch(`${API}/functions/v1/fleet-files`, { method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }, body: form });
  return { status: res.status, body: (await res.json()) as { path?: string; mime?: string; error?: string } };
}

async function company(adminEmail: string) {
  const c = await rpcAs<{ id: string }>(adminEmail, 'create_company', {
    p_name: `Fișiere ${Date.now()}`,
    p_vat_id: null,
    p_reg_com: null,
    p_address: null,
    p_request_id: crypto.randomUUID(),
  });
  const v = await rpcAs<{ id: string }>(adminEmail, 'fleet_save_vehicle', {
    p_company: c.id,
    p_vehicle: null,
    p_fields: { make: 'Dacia', model: 'Logan', plate: uniquePlate('B') },
    p_request_id: crypto.randomUUID(),
  });
  return { company: c.id, vehicle: v.id };
}

test.describe('fleet files (A6)', () => {
  test.skip(!BACKEND, 'needs the local Supabase stack');

  test('checked, cleaned and limited on the server; nothing else reaches the bucket', async () => {
    test.skip(test.info().project.name !== 'desktop-1440', 'API only: once');
    // About 25 calls to Auth, the database and the Edge Function (with a 6 MB body): as the support files' test.
    test.setTimeout(120_000);
    const admin = await createFleetUser();
    const other = await createFleetUser();
    const mine = await company(admin);
    const theirs = await company(other);
    const token = await tokenOf(admin);

    await test.step('a real PNG and a real PDF are stored', async () => {
      const png = await upload(token, mine, { name: 'bon.png', type: 'image/png', bytes: Buffer.from(PNG, 'base64') });
      expect(png.status, JSON.stringify(png.body)).toBe(200);
      expect(png.body.path).toMatch(new RegExp(`^${mine.company}/${mine.vehicle}/[0-9a-f-]{36}\\.png$`));
      const pdf = await upload(token, mine, { name: 'factura.pdf', type: 'application/pdf', bytes: PDF });
      expect(pdf.status, JSON.stringify(pdf.body)).toBe(200);
    });
    await test.step('what is refused, and why', async () => {
      const refused = async (file: { name: string; type: string; bytes: Buffer }, code: string, issue?: string) => {
        const r = await upload(token, issue ? { ...mine, issue } : mine, file);
        expect(r.body.error, file.name).toBe(code);
      };
      await refused({ name: 'poza.png', type: 'image/png', bytes: b('#!/bin/sh\necho not an image\n') }, 'file_type');
      await refused({ name: 'stricata.png', type: 'image/png', bytes: Buffer.from(PNG, 'base64').subarray(0, 60) }, 'file_corrupt');
      await refused({ name: 'factura.pdf', type: 'application/pdf', bytes: ACTIVE_PDF }, 'file_pdf_active');
      await refused({ name: 'raport.pdf', type: 'application/pdf', bytes: PDF }, 'file_type', crypto.randomUUID());
      await refused({ name: 'mare.png', type: 'image/png', bytes: Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(6 * 1024 * 1024)]) }, 'file_too_large');
    });
    await test.step('a phone photo loses its GPS block', async () => {
      const photo = await upload(token, mine, { name: 'IMG_2026.jpg', type: 'image/jpeg', bytes: phoneJpeg() });
      expect(photo.status, JSON.stringify(photo.body)).toBe(200);
      const stored = await fetch(`${API}/storage/v1/object/fleet-files/${photo.body.path}`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const text = Buffer.from(await stored.arrayBuffer()).toString('latin1');
    for (const personal of ['GPS-LAT', 'Samsung', 'Ion Popescu']) expect(text, personal).not.toContain(personal);

    });
    await test.step("another company's vehicle is refused", async () => {
      const cross = await upload(token, theirs, { name: 'bon.png', type: 'image/png', bytes: Buffer.from(PNG, 'base64') });
      expect(cross.body.error).toBe('not_allowed');
    });
    await test.step('no direct write to the bucket', async () => {
      const direct = await fetch(`${API}/storage/v1/object/fleet-files/${mine.company}/${mine.vehicle}/${crypto.randomUUID()}.png`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
        body: new Uint8Array(Buffer.from(PNG, 'base64')),
    });
    expect(direct.ok).toBe(false);

    });
    await test.step('a suspended account is refused', async () => {
      const me = await userIdOf(admin);
      await serviceRest(`profiles?id=eq.${me}`, 'PATCH', { suspended: true });
      const r = await upload(token, mine, { name: 'bon.png', type: 'image/png', bytes: Buffer.from(PNG, 'base64') });
      expect(r.body.error).toBe('account_suspended');
      await serviceRest(`profiles?id=eq.${me}`, 'PATCH', { suspended: false });
    });
  });
});
