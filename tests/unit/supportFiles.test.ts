import { describe, expect, it } from 'vitest';
import { checkFile, cleanName, detectKind, MAX_FILE_BYTES, tiffOrientation } from '../../supabase/functions/_shared/supportFiles.ts';
import { JPEG, PNG, WEBP } from './fixtures/support-files/images';

// A3b — the support files' checks: the real type from the bytes, whole files only, active PDFs refused,
// every piece of metadata about a person removed from photos with the orientation kept.

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const text = (b: Uint8Array) => String.fromCharCode(...b);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const be16 = (n: number) => Uint8Array.of((n >> 8) & 255, n & 255);
const be32 = (n: number) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const le32 = (n: number) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);

/**
 * A big-endian TIFF block as a phone writes it: the camera's make and model, the owner, the time,
 * a GPS block, and the orientation.
 */
function phoneTiff(orientation: number): Uint8Array {
  const strings = ['Samsung', 'SM-G991B', 'Ion Popescu', '2026:11:07 10:15:00'];
  const tags = [0x010f, 0x0110, 0x013b, 0x0132];
  const entries = tags.length + 2;
  const ifdSize = 2 + entries * 12 + 4;
  let dataOff = 8 + ifdSize;
  const data: Uint8Array[] = [];
  const ifd: Uint8Array[] = [be16(entries)];
  strings.forEach((s, k) => {
    const v = bytes(`${s}\u0000`);
    ifd.push(be16(tags[k]!), be16(2), be32(v.length), be32(dataOff));
    data.push(v);
    dataOff += v.length;
  });
  ifd.push(be16(0x0112), be16(3), be32(1), cat(be16(orientation), be16(0)));
  // GPSInfo → a GPS IFD with the latitude reference and the latitude itself, as text that must vanish.
  const gpsAt = dataOff;
  ifd.push(be16(0x8825), be16(4), be32(1), be32(gpsAt));
  ifd.push(be32(0));
  const gpsText = bytes('GPS-LAT-44.4268N\u0000');
  const gps = cat(be16(1), be16(0x0002), be16(2), be32(gpsText.length), be32(gpsAt + 18), be32(0), gpsText);
  return cat(bytes('MM'), be16(42), be32(8), ...ifd, ...data, gps);
}
const PERSONAL = ['Samsung', 'SM-G991B', 'Ion Popescu', '2026:11:07', 'GPS-LAT', 'Popescu-XMP', 'Popescu-IPTC', 'Popescu-COM', 'MOTIONVIDEO'];
const noPersonal = (b: Uint8Array) => {
  const s = text(b);
  return PERSONAL.filter((p) => s.includes(p));
};

// ------------------------------------------------------------------------------------ JPEG
function jpegSegment(marker: number, payload: Uint8Array) {
  return cat(Uint8Array.of(0xff, marker), be16(payload.length + 2), payload);
}
function phoneJpeg(orientation: number): Uint8Array {
  const base = fromB64(JPEG);
  return cat(
    base.subarray(0, 2),
    jpegSegment(0xe1, cat(bytes('Exif\u0000\u0000'), phoneTiff(orientation))),
    jpegSegment(0xe1, bytes('http://ns.adobe.com/xap/1.0/\u0000<x:xmpmeta>Popescu-XMP</x:xmpmeta>')),
    jpegSegment(0xed, bytes('Photoshop 3.0\u00008BIM Popescu-IPTC')),
    jpegSegment(0xe2, bytes('MPF\u0000extra pictures')),
    jpegSegment(0xfe, bytes('Popescu-COM')),
    base.subarray(2),
    bytes('MOTIONVIDEO appended after the image'),
  );
}
function jpegOrientation(b: Uint8Array): number {
  for (let i = 2; i < b.length - 4; ) {
    const marker = b[i + 1]!;
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (marker === 0xe1 && text(b.subarray(i + 4, i + 10)) === 'Exif\u0000\u0000') return tiffOrientation(b.subarray(i + 10, i + 2 + len));
    if (marker === 0xda) return 1;
    i += 2 + len;
  }
  return 1;
}

// ------------------------------------------------------------------------------------ PNG
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
const pngChunk = (type: string, data: Uint8Array) => cat(be32(data.length), bytes(type), data, be32(crc32(cat(bytes(type), data))));
function phonePng(orientation: number): Uint8Array {
  const base = fromB64(PNG);
  const afterIhdr = 8 + 12 + 13;
  return cat(
    base.subarray(0, afterIhdr),
    pngChunk('eXIf', phoneTiff(orientation)),
    pngChunk('tEXt', bytes('Author\u0000Ion Popescu')),
    pngChunk('iTXt', bytes('XML:com.adobe.xmp\u0000\u0000\u0000\u0000\u0000Popescu-XMP')),
    base.subarray(afterIhdr),
  );
}
function pngOrientation(b: Uint8Array): number {
  for (let i = 8; i < b.length; ) {
    const len = (b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!;
    if (text(b.subarray(i + 4, i + 8)) === 'eXIf') return tiffOrientation(b.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  return 1;
}

// ------------------------------------------------------------------------------------ WebP
const riff = (fourcc: string, data: Uint8Array) => cat(bytes(fourcc), le32(data.length), data, data.length % 2 ? Uint8Array.of(0) : new Uint8Array(0));
function phoneWebp(orientation: number): Uint8Array {
  // Chromium's WebP is extended already (VP8X, its colour profile, the image): EXIF and XMP are added
  // and flagged, as a phone's camera does.
  const chunks = webpChunks(fromB64(WEBP));
  const vp8x = chunks.VP8X!.slice();
  vp8x[0] = vp8x[0]! | 0x0c;
  const body = cat(
    bytes('WEBP'),
    riff('VP8X', vp8x),
    ...Object.entries(chunks)
      .filter(([k]) => k !== 'VP8X')
      .map(([k, v]) => riff(k, v)),
    riff('EXIF', phoneTiff(orientation)),
    riff('XMP ', bytes('<x:xmpmeta>Popescu-XMP</x:xmpmeta>')),
  );
  return cat(bytes('RIFF'), le32(body.length), body);
}
function webpChunks(b: Uint8Array): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (let i = 12; i < b.length; ) {
    const len = b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24);
    out[text(b.subarray(i, i + 4))] = b.subarray(i + 8, i + 8 + len);
    i += 8 + len + (len % 2);
  }
  return out;
}

// ------------------------------------------------------------------------------------ PDF
function pdf(body: string): Uint8Array {
  return bytes(`%PDF-1.7\n${body}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);
}
const PLAIN_PDF = pdf('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj');
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(c) {
      c.enqueue(data as BufferSource);
      c.close();
    },
  });
  const reader = source.pipeThrough(new CompressionStream('deflate')).getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return cat(...parts);
}
async function pdfWithStream(content: Uint8Array, dict: string): Promise<Uint8Array> {
  const z = await deflate(content);
  return cat(
    bytes(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n3 0 obj\n<< ${dict} /Filter /FlateDecode /Length ${z.length} >>\nstream\n`),
    z,
    bytes('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'),
  );
}

describe('support files: the real type, from the bytes (A3b)', () => {
  it('knows the four types by their signature, nothing else', () => {
    expect(detectKind(fromB64(PNG))).toBe('png');
    expect(detectKind(fromB64(JPEG))).toBe('jpeg');
    expect(detectKind(fromB64(WEBP))).toBe('webp');
    expect(detectKind(PLAIN_PDF)).toBe('pdf');
    expect(detectKind(bytes('GIF89a....'))).toBeNull();
    expect(detectKind(bytes('<html><script>alert(1)</script>'))).toBeNull();
  });

  it('the declared name or type does not matter', async () => {
    expect(await checkFile(bytes('#!/bin/sh\nrm -rf /'), 'poza.png')).toEqual({ ok: false, reason: 'type' });
    const renamed = await checkFile(fromB64(PNG), 'factura.pdf');
    expect(renamed).toMatchObject({ ok: true, kind: 'png', mime: 'image/png', name: 'factura.png' });
  });

  it('empty and too large files are refused', async () => {
    expect(await checkFile(new Uint8Array(0), 'x.png')).toEqual({ ok: false, reason: 'empty' });
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(fromB64(PNG));
    expect(await checkFile(big, 'x.png')).toEqual({ ok: false, reason: 'too_large' });
  });

  it('names: no path, no control characters, the right extension, at most 100 characters', () => {
    expect(cleanName('C:\\Users\\ion\\Desktop\\captură ecran.JPEG', 'jpeg')).toBe('captură ecran.jpg');
    expect(cleanName('../../etc/passwd', 'pdf')).toBe('passwd.pdf');
    expect(cleanName('a\u0000b<c>.png', 'png')).toBe('abc.png');
    expect(cleanName('', 'webp')).toBe('fisier.webp');
    expect(cleanName(`${'x'.repeat(300)}.png`, 'png').length).toBeLessThanOrEqual(100);
  });
});

describe('support files: photos lose every personal detail, keep their orientation', () => {
  it('JPEG: EXIF, GPS, XMP, IPTC, comments, extra pictures and an appended video go; the orientation stays', async () => {
    const r = await checkFile(phoneJpeg(6), 'IMG_2026.jpg');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(noPersonal(r.bytes)).toEqual([]);
    expect(jpegOrientation(r.bytes)).toBe(6);
    expect(r.bytes.slice(-2)).toEqual(Uint8Array.of(0xff, 0xd9));
    // The clean copy is itself a sound JPEG.
    expect(await checkFile(r.bytes, 'again.jpg')).toMatchObject({ ok: true, kind: 'jpeg' });
  });

  it('JPEG upright: no EXIF left at all', async () => {
    const r = await checkFile(phoneJpeg(1), 'a.jpg');
    expect(r.ok && text(r.bytes).includes('Exif')).toBe(false);
  });

  it('PNG: eXIf and text chunks go; the orientation stays before the image data', async () => {
    const r = await checkFile(phonePng(3), 'screen.png');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(noPersonal(r.bytes)).toEqual([]);
    expect(pngOrientation(r.bytes)).toBe(3);
    expect(text(r.bytes).indexOf('eXIf')).toBeLessThan(text(r.bytes).indexOf('IDAT'));
    expect(await checkFile(r.bytes, 'again.png')).toMatchObject({ ok: true, kind: 'png' });
  });

  it('WebP: EXIF and XMP go, the flags follow, the orientation stays', async () => {
    const r = await checkFile(phoneWebp(8), 'p.webp');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(noPersonal(r.bytes)).toEqual([]);
    const chunks = webpChunks(r.bytes);
    expect(chunks['XMP ']).toBeUndefined();
    expect(tiffOrientation(chunks.EXIF!)).toBe(8);
    expect(chunks.VP8X![0]! & 0x0c).toBe(0x08);
    expect(chunks.ICCP).toBeDefined();
    expect(await checkFile(r.bytes, 'again.webp')).toMatchObject({ ok: true, kind: 'webp' });
  });

  it('the canvas images themselves pass unchanged in content', async () => {
    for (const [b64, kind] of [
      [PNG, 'png'],
      [JPEG, 'jpeg'],
      [WEBP, 'webp'],
    ] as const) {
      expect(await checkFile(fromB64(b64), `x.${kind}`)).toMatchObject({ ok: true, kind });
    }
  });
});

describe('support files: broken files are refused', () => {
  it('cut short, at any point', async () => {
    for (const whole of [fromB64(PNG), fromB64(JPEG), fromB64(WEBP), phoneJpeg(6)]) {
      for (const keep of [0.25, 0.5, 0.9]) {
        const r = await checkFile(whole.subarray(0, Math.floor(whole.length * keep)), 'cut');
        expect(r, `${detectKind(whole)} at ${keep}`).toEqual({ ok: false, reason: 'corrupt' });
      }
    }
  });

  it('a PNG with a wrong checksum or something after its end', async () => {
    const bad = fromB64(PNG).slice();
    bad[30] = bad[30]! ^ 0xff;
    expect(await checkFile(bad, 'x.png')).toEqual({ ok: false, reason: 'corrupt' });
    expect(await checkFile(cat(fromB64(PNG), bytes('<script>')), 'x.png')).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('a JPEG without its image, a WebP whose size lies', async () => {
    const soiOnly = cat(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9));
    expect(await checkFile(soiOnly, 'x.jpg')).toEqual({ ok: false, reason: 'corrupt' });
    const lying = fromB64(WEBP).slice();
    lying[4] = lying[4]! + 40;
    expect(await checkFile(lying, 'x.webp')).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('a PDF without its end, or without objects', async () => {
    expect(await checkFile(bytes('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'), 'x.pdf')).toEqual({ ok: false, reason: 'corrupt' });
    expect(await checkFile(bytes('%PDF-1.7\nhello\n%%EOF'), 'x.pdf')).toEqual({ ok: false, reason: 'corrupt' });
  });
});

describe('support files: PDFs that act on their own are refused', () => {
  it('a plain PDF passes, unchanged', async () => {
    const r = await checkFile(PLAIN_PDF, 'deviz.pdf');
    expect(r).toMatchObject({ ok: true, kind: 'pdf', name: 'deviz.pdf' });
    expect(r.ok && r.bytes).toEqual(PLAIN_PDF);
  });

  it('JavaScript, launch actions, embedded files, XFA, form submission — however written', async () => {
    for (const body of [
      '1 0 obj\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\nendobj',
      '1 0 obj\n<< /OpenAction << /S /J#61vaScript /JS (x) >> >>\nendobj',
      '1 0 obj\n<< /AA << /O << /S /Launch /F (cmd.exe) >> >> >>\nendobj',
      '1 0 obj\n<< /Names << /EmbeddedFiles 2 0 R >> >>\nendobj',
      '1 0 obj\n<< /AcroForm << /XFA 5 0 R >> >>\nendobj',
      '1 0 obj\n<< /A << /S /SubmitForm /F (https://x) >> >>\nendobj',
      '1 0 obj\n<< /A << /S /GoToR /F (other.pdf) >> >>\nendobj',
    ]) {
      expect(await checkFile(pdf(body), 'x.pdf'), body).toEqual({ ok: false, reason: 'pdf_active' });
    }
  });

  it('JavaScript hidden inside a compressed object stream', async () => {
    const hidden = await pdfWithStream(bytes('4 0 << /S /JavaScript /JS (app.launchURL("x")) >>'), '/Type /ObjStm /N 1 /First 4');
    expect(await checkFile(hidden, 'x.pdf')).toEqual({ ok: false, reason: 'pdf_active' });
    const clean = await pdfWithStream(bytes('BT /F1 12 Tf (Factura) Tj ET'), '');
    expect(await checkFile(clean, 'x.pdf')).toMatchObject({ ok: true, kind: 'pdf' });
  });

  it('an object stream behind another filter is not trusted', async () => {
    const other = bytes('%PDF-1.7\n1 0 obj\n<< /Type /ObjStm /Filter /LZWDecode /Length 3 >>\nstream\nabc\nendstream\nendobj\ntrailer\n<<>>\n%%EOF\n');
    expect(await checkFile(other, 'x.pdf')).toEqual({ ok: false, reason: 'pdf_active' });
  });

  it('an encrypted PDF cannot be checked: refused', async () => {
    expect(await checkFile(pdf('1 0 obj\n<< >>\nendobj\n2 0 obj\n<< /Filter /Standard >>\nendobj\ntrailer << /Encrypt 2 0 R >>'), 'x.pdf')).toEqual({
      ok: false,
      reason: 'pdf_encrypted',
    });
  });

  it('a compressed stream that does not decompress, or a decompression bomb', async () => {
    const broken = cat(
      bytes('%PDF-1.7\n1 0 obj\n<< /Filter /FlateDecode /Length 8 >>\nstream\n'),
      bytes('notzlib!'),
      bytes('\nendstream\nendobj\ntrailer\n<<>>\n%%EOF\n'),
    );
    expect(await checkFile(broken, 'x.pdf')).toEqual({ ok: false, reason: 'corrupt' });
    const bomb = await pdfWithStream(new Uint8Array(70 * 1024 * 1024), '');
    expect(bomb.length).toBeLessThan(MAX_FILE_BYTES);
    expect(await checkFile(bomb, 'x.pdf')).toEqual({ ok: false, reason: 'corrupt' });
  });
});
