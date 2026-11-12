import { describe, expect, it } from 'vitest';
import { kindAllowed, parseTarget, refusalStatus, rejectionCode, securityKind } from '../../supabase/functions/_shared/fleetFiles.ts';
import { checkFile } from '../../supabase/functions/_shared/supportFiles.ts';
import { JPEG, PNG } from './fixtures/support-files/images';

// A6 (M4) — the fleet files' rules around the support files' content checks (tests/unit/supportFiles
// tests those in depth): where a file may go, what a report takes, the codes and the security log.

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const text = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');
const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/** A phone photo: the fixture JPEG with an EXIF block holding a GPS latitude as text. */
function jpegWithGps(): Uint8Array {
  const gpsText = [...bytes('GPS-LAT-44.4268N\u0000')];
  const ifdOff = 8;
  const gpsIfd = ifdOff + 2 + 2 * 12 + 4;
  const tiff = [
    ...bytes('MM'), ...be16(42), ...be32(ifdOff),
    ...be16(2),
    ...be16(0x0112), ...be16(3), ...be32(1), ...be16(1), ...be16(0),
    ...be16(0x8825), ...be16(4), ...be32(1), ...be32(gpsIfd),
    ...be32(0),
    ...be16(1), ...be16(0x0002), ...be16(2), ...be32(gpsText.length), ...be32(gpsIfd + 18), ...be32(0),
    ...gpsText,
  ];
  const payload = [...bytes('Exif\u0000\u0000'), ...tiff];
  const app1 = [0xff, 0xe1, ...be16(payload.length + 2), ...payload];
  const base = fromB64(JPEG);
  return Uint8Array.from([...base.subarray(0, 2), ...app1, ...base.subarray(2)]);
}

const C = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
const I = '33333333-3333-4333-8333-333333333333';

describe('fleet file target', () => {
  it('takes a company and a vehicle, and a report only when given', () => {
    expect(parseTarget({ company: C, vehicle: V })).toEqual({ company: C, vehicle: V, issue: null });
    expect(parseTarget({ company: C, vehicle: V, issue: I })).toEqual({ company: C, vehicle: V, issue: I });
    expect(parseTarget({ company: C, vehicle: V, issue: '' })).toEqual({ company: C, vehicle: V, issue: null });
    expect(parseTarget({ company: C.toUpperCase(), vehicle: V })?.company).toBe(C);
  });

  it('refuses anything that is not an id (no path tricks)', () => {
    expect(parseTarget({ company: C })).toBeNull();
    expect(parseTarget({ company: '../etc', vehicle: V })).toBeNull();
    expect(parseTarget({ company: C, vehicle: `${V}/../x` })).toBeNull();
    expect(parseTarget({ company: C, vehicle: V, issue: 'not-an-id' })).toBeNull();
    expect(parseTarget({ company: 42, vehicle: V })).toBeNull();
  });

  it('a report takes photos only, a receipt a photo or a PDF', () => {
    expect(kindAllowed('pdf', { company: C, vehicle: V, issue: null })).toBe(true);
    expect(kindAllowed('pdf', { company: C, vehicle: V, issue: I })).toBe(false);
    expect(kindAllowed('jpeg', { company: C, vehicle: V, issue: I })).toBe(true);
  });
});

describe('fleet file content (the support files checks)', () => {
  it('a real PNG passes, a text named .png does not, whatever the browser says', async () => {
    const ok = await checkFile(fromB64(PNG), 'bon.png');
    expect(ok.ok && ok.mime).toBe('image/png');
    const fake = await checkFile(bytes('#!/bin/sh\necho not an image\n'), 'bon.png');
    expect(fake.ok).toBe(false);
    if (!fake.ok) expect(rejectionCode(fake)).toBe('file_type');
  });

  it('a PDF with JavaScript is refused', async () => {
    const r = await checkFile(bytes('%PDF-1.7\n1 0 obj\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'), 'f.pdf');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(rejectionCode(r)).toBe('file_pdf_active');
  });

  it('a phone photo loses its GPS block and keeps being a JPEG', async () => {
    const input = jpegWithGps();
    expect(text(input)).toContain('GPS-LAT');
    const r = await checkFile(input, 'IMG_1.jpg');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mime).toBe('image/jpeg');
      expect(text(r.bytes)).not.toContain('GPS-LAT');
    }
  });

  it('an empty file is broken, an oversized one too large', () => {
    expect(rejectionCode({ ok: false, reason: 'empty' })).toBe('file_corrupt');
    expect(rejectionCode({ ok: false, reason: 'too_large' })).toBe('file_too_large');
  });
});

describe('fleet file refusals', () => {
  it('answer the right status', () => {
    expect(refusalStatus('not_signed_in')).toBe(401);
    expect(refusalStatus('limit_fleet_uploads')).toBe(429);
    expect(refusalStatus('too_many_photos')).toBe(429);
    expect(refusalStatus('file_too_large')).toBe(413);
    expect(refusalStatus('file_pdf_active')).toBe(422);
    expect(refusalStatus('not_allowed')).toBe(403);
  });

  it('only the ones that matter reach the security log', () => {
    expect(securityKind('file_pdf_active')).toEqual({ kind: 'file_rejected', severity: 'high' });
    expect(securityKind('file_type')).toEqual({ kind: 'file_rejected', severity: 'warning' });
    expect(securityKind('not_allowed')).toEqual({ kind: 'access_denied', severity: 'warning' });
    expect(securityKind('limit_fleet_uploads')?.kind).toBe('limit_fleet_uploads');
    expect(securityKind('file_too_large')).toBeNull();
    expect(securityKind('too_many_photos')).toBeNull();
  });
});
