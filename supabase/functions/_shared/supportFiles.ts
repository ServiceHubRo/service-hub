// A3b — the files attached to support requests: what a file really is (from its bytes, never from
// the name or the type the browser declares), whether it is whole, and a clean copy of it.
//
// · PNG, JPEG, WebP, PDF only; at most 5 MB.
// · Images: the structure is walked from start to end (PNG chunks with their checksums, JPEG
//   segments, WebP RIFF chunks); anything cut short, inconsistent or trailing is refused or cut off.
//   Every piece of metadata that can tell about a person is removed — EXIF (location, camera,
//   serial numbers, dates, owner), XMP, IPTC, comments, text chunks, embedded extra images (MPF,
//   motion photos appended after the image) — and the orientation alone is written back, so the
//   photo shows the right way up.
// · PDF: whole (header, end marker, objects), not encrypted, and without active content
//   (JavaScript, launch actions, embedded files, rich media, XFA forms, form submission, data
//   import, links to other files). Names are decoded (#xx escapes) and every Flate stream (object
//   streams included) is decompressed and searched too, with a cap against decompression bombs.
//
// Pure (no Deno, no Node): the Edge Function support-files and the unit tests use the same code.

export type FileKind = 'png' | 'jpeg' | 'webp' | 'pdf';
export type Rejection = 'empty' | 'too_large' | 'type' | 'corrupt' | 'pdf_active' | 'pdf_encrypted';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const FILE_MIME: Record<FileKind, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
};
const EXTENSION: Record<FileKind, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', pdf: 'pdf' };

export type CheckResult =
  | { ok: true; kind: FileKind; mime: string; bytes: Uint8Array; name: string }
  | { ok: false; reason: Rejection };

class Corrupt extends Error {}
const fail = (): never => {
  throw new Corrupt('corrupt');
};

/** What the bytes are, by their signature; null for anything else. */
export function detectKind(b: Uint8Array): FileKind | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  if (at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return 'pdf';
  return null;
}

/** A file's name to show: no path, no control characters, at most 100 characters, the right extension. */
export function cleanName(name: string, kind: FileKind): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const stem = base.replace(/\.[^.]{1,8}$/, '').slice(0, 90).trim() || 'fisier';
  return `${stem}.${EXTENSION[kind]}`;
}

/** Checks a file and answers a clean copy of it, or why it is refused. */
export async function checkFile(bytes: Uint8Array, name: string): Promise<CheckResult> {
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, reason: 'too_large' };
  const kind = detectKind(bytes);
  if (!kind) return { ok: false, reason: 'type' };
  try {
    let clean: Uint8Array;
    switch (kind) {
      case 'png':
        clean = cleanPng(bytes);
        break;
      case 'jpeg':
        clean = cleanJpeg(bytes);
        break;
      case 'webp':
        clean = cleanWebp(bytes);
        break;
      case 'pdf': {
        const verdict = await checkPdf(bytes);
        if (verdict) return { ok: false, reason: verdict };
        clean = bytes;
        break;
      }
    }
    return { ok: true, kind, mime: FILE_MIME[kind], bytes: clean, name: cleanName(name, kind) };
  } catch (e) {
    if (e instanceof Corrupt || e instanceof RangeError) return { ok: false, reason: 'corrupt' };
    throw e;
  }
}

// ------------------------------------------------------------------------------------ bytes

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32le = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
const bytesOf = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
function be32(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}
function le32(n: number): Uint8Array {
  return Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------------------------ EXIF orientation

/** The orientation (1–8) in a TIFF block (EXIF data after its "Exif\0\0" prefix), or 1. */
export function tiffOrientation(t: Uint8Array): number {
  if (t.length < 8) return 1;
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return 1;
  const r16 = (i: number) => (le ? t[i]! | (t[i + 1]! << 8) : (t[i]! << 8) | t[i + 1]!);
  const r32 = (i: number) => (le ? u32le(t, i) : u32be(t, i));
  const ifd = r32(4);
  if (ifd + 2 > t.length) return 1;
  const count = r16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) return 1;
    if (r16(e) === 0x0112) {
      const v = r16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/** A TIFF block with the orientation only (little-endian, one IFD entry). */
function orientationTiff(orientation: number): Uint8Array {
  return Uint8Array.of(
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // header, IFD0 at 8
    0x01, 0x00, // one entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation & 255, 0x00, 0x00, 0x00, // Orientation, SHORT, 1
    0x00, 0x00, 0x00, 0x00, // no next IFD
  );
}
const EXIF_PREFIX = bytesOf('Exif\u0000\u0000');

// ------------------------------------------------------------------------------------ PNG

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typed = concat([bytesOf(type), data]);
  return concat([be32(data.length), typed, be32(crc32(typed))]);
}

function cleanPng(b: Uint8Array): Uint8Array {
  let i = 8;
  let first = true;
  let sawData = false;
  let ended = false;
  let orientation = 1;
  const kept: Uint8Array[] = [];
  while (i < b.length) {
    if (i + 12 > b.length) fail();
    const len = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type) || len > b.length - i - 12) fail();
    const whole = b.subarray(i, i + 12 + len);
    if (crc32(b.subarray(i + 4, i + 8 + len)) !== u32be(b, i + 8 + len)) fail();
    if (first) {
      if (type !== 'IHDR' || len !== 13) fail();
      const w = u32be(b, i + 8);
      const h = u32be(b, i + 12);
      if (w === 0 || h === 0 || w > 20000 || h > 20000) fail();
      first = false;
    }
    if (type === 'IDAT') sawData = true;
    if (type === 'eXIf') orientation = tiffOrientation(b.subarray(i + 8, i + 8 + len));
    if (!PNG_DROP.has(type)) {
      // The orientation goes back just before the image data.
      if (type === 'IDAT' && orientation !== 1 && !kept.some((c) => ascii(c, 4, 4) === 'eXIf')) {
        kept.push(pngChunk('eXIf', orientationTiff(orientation)));
      }
      kept.push(whole);
    }
    i += 12 + len;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended || !sawData || i !== b.length) fail();
  return concat([PNG_SIGNATURE, ...kept]);
}

// ------------------------------------------------------------------------------------ JPEG

function cleanJpeg(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)];
  let i = 2;
  let orientation = 1;
  let sawFrame = false;
  let sawScan = false;
  let end = -1;
  const headers: Uint8Array[] = [];
  while (i < b.length) {
    if (b[i] !== 0xff) fail();
    while (b[i] === 0xff) i++; // fill bytes
    if (i >= b.length) fail();
    const marker = b[i++]!;
    if (marker === 0xd9) {
      end = i;
      break;
    }
    if (marker === 0xd8 || marker === 0x00) fail();
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(Uint8Array.of(0xff, marker));
      continue;
    }
    if (i + 2 > b.length) fail();
    const len = u16be(b, i);
    if (len < 2 || i + len > b.length) fail();
    const seg = b.subarray(i - 2, i + len);
    const data = b.subarray(i + 2, i + len);
    i += len;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (data.length < 6 || u16be(data, 1) === 0 || u16be(data, 3) === 0) fail();
      sawFrame = true;
    }
    // Metadata out: APP1 (EXIF, XMP), APP2 other than the colour profile (MPF: extra images),
    // APP3–APP13 (IPTC is APP13), APP15, comments. Kept: APP0 (JFIF), the ICC profile, APP14 (Adobe colour).
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if (marker === 0xe1 && ascii(data, 0, 6) === 'Exif\u0000\u0000') orientation = tiffOrientation(data.subarray(6));
    const keep = !isApp ? marker !== 0xfe : marker === 0xe0 || marker === 0xee || (marker === 0xe2 && ascii(data, 0, 12) === 'ICC_PROFILE\u0000');
    if (keep) (isApp ? headers : out).push(seg);
    if (marker === 0xda) {
      if (!sawFrame) fail();
      sawScan = true;
      // Entropy-coded data up to the next marker (FF 00 is a data byte, FF D0–D7 restarts).
      const start = i;
      while (i < b.length) {
        if (b[i] === 0xff && b[i + 1] !== 0x00 && !(b[i + 1]! >= 0xd0 && b[i + 1]! <= 0xd7) && b[i + 1] !== 0xff) break;
        i++;
      }
      if (i >= b.length) fail();
      out.push(b.subarray(start, i));
    }
  }
  if (end < 0 || !sawFrame || !sawScan) fail();
  // Anything after the end of the image (a motion photo's video, extra pictures) is cut off.
  const app0 = headers.filter((h) => h[1] === 0xe0);
  const rest = headers.filter((h) => h[1] !== 0xe0);
  const exif =
    orientation !== 1
      ? (() => {
          const payload = concat([EXIF_PREFIX, orientationTiff(orientation)]);
          return concat([Uint8Array.of(0xff, 0xe1, ((payload.length + 2) >> 8) & 255, (payload.length + 2) & 255), payload]);
        })()
      : null;
  return concat([out[0]!, ...app0, ...(exif ? [exif] : []), ...rest, ...out.slice(1), Uint8Array.of(0xff, 0xd9)]);
}

// ------------------------------------------------------------------------------------ WebP

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  return concat([bytesOf(fourcc), le32(data.length), data, data.length % 2 ? Uint8Array.of(0) : new Uint8Array(0)]);
}

function cleanWebp(b: Uint8Array): Uint8Array {
  const size = u32le(b, 4);
  if (size + 8 !== b.length && size + 9 !== b.length) fail();
  let i = 12;
  let orientation = 1;
  let sawImage = false;
  let vp8x: Uint8Array | null = null;
  let first = true;
  const kept: { fourcc: string; data: Uint8Array }[] = [];
  while (i < 8 + size) {
    if (i + 8 > b.length) fail();
    const fourcc = ascii(b, i, 4);
    const len = u32le(b, i + 4);
    if (i + 8 + len > b.length) fail();
    const data = b.subarray(i + 8, i + 8 + len);
    if (first && fourcc !== 'VP8 ' && fourcc !== 'VP8L' && fourcc !== 'VP8X') fail();
    first = false;
    if (fourcc === 'VP8 ') {
      if (len < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) fail();
      sawImage = true;
    }
    if (fourcc === 'VP8L') {
      if (len < 5 || data[0] !== 0x2f) fail();
      sawImage = true;
    }
    if (fourcc === 'ANMF') sawImage = true;
    if (fourcc === 'VP8X') {
      if (len < 10) fail();
      vp8x = data.slice();
    }
    if (fourcc === 'EXIF') {
      const tiff = ascii(data, 0, 6) === 'Exif\u0000\u0000' ? data.subarray(6) : data;
      orientation = tiffOrientation(tiff);
    }
    if (fourcc !== 'EXIF' && fourcc !== 'XMP ' && fourcc !== 'VP8X') kept.push({ fourcc, data });
    i += 8 + len + (len % 2);
  }
  if (!sawImage) fail();
  const parts: Uint8Array[] = [];
  if (vp8x) {
    // EXIF (bit 3) and XMP (bit 2) are gone; EXIF comes back with the orientation alone.
    vp8x[0] = (vp8x[0]! & ~0x0c) | (orientation !== 1 ? 0x08 : 0);
    parts.push(riffChunk('VP8X', vp8x));
  }
  for (const c of kept) parts.push(riffChunk(c.fourcc, c.data));
  // A simple WebP (no VP8X) cannot carry EXIF: its orientation is dropped with the rest.
  if (vp8x && orientation !== 1) parts.push(riffChunk('EXIF', orientationTiff(orientation)));
  const body = concat([bytesOf('WEBP'), ...parts]);
  return concat([bytesOf('RIFF'), le32(body.length), body]);
}

// ------------------------------------------------------------------------------------ PDF

/** Names that make a PDF act on its own or carry other files: refused. */
const PDF_ACTIVE = new Set([
  'JavaScript',
  'JS',
  'Launch',
  'EmbeddedFile',
  'EmbeddedFiles',
  'RichMedia',
  'XFA',
  'SubmitForm',
  'ImportData',
  'GoToR',
  'GoToE',
  'Sound',
  'Movie',
]);
/** The most a PDF's compressed streams may expand to, together (a decompression bomb is refused). */
const PDF_INFLATE_LIMIT = 64 * 1024 * 1024;

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};

/** The PDF names (`/Name`) in a piece of text, with #xx escapes decoded. */
function pdfNames(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/\/([^\s/<>[\]()%{}]+)/g)) {
    names.push(m[1]!.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))));
  }
  return names;
}

async function inflate(data: Uint8Array, budget: { left: number }): Promise<Uint8Array> {
  try {
    return await inflateRaw(data, budget);
  } catch {
    // Data that does not decompress, or more than the budget: the file is not sound.
    return fail();
  }
}

async function inflateRaw(data: Uint8Array, budget: { left: number }): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(c) {
      c.enqueue(data as BufferSource);
      c.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    budget.left -= value.length;
    if (budget.left < 0) {
      await reader.cancel();
      fail();
    }
    parts.push(value);
  }
  return concat(parts);
}

/** null when the PDF is whole and passive; else why it is refused. */
async function checkPdf(b: Uint8Array): Promise<Rejection | null> {
  const text = latin1(b);
  if (!/^%PDF-[12]\.\d/.test(text)) fail();
  if (!text.slice(-1024).includes('%%EOF')) fail();
  if (!/\d+\s+\d+\s+obj\b/.test(text)) fail();
  const names = pdfNames(text);
  if (names.includes('Encrypt')) return 'pdf_encrypted';
  if (names.some((n) => PDF_ACTIVE.has(n))) return 'pdf_active';

  // Every stream compressed with Flate (object streams too): decompressed and searched as well.
  const budget = { left: PDF_INFLATE_LIMIT };
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (text.slice(Math.max(0, m.index - 3), m.index) === 'end') continue;
    const dictStart = text.lastIndexOf('<<', m.index);
    const dict = dictStart >= 0 ? text.slice(dictStart, m.index) : '';
    const end = text.indexOf('endstream', m.index + m[0].length);
    if (end < 0) fail();
    const filters = pdfNames(dict);
    const isObjStm = filters.includes('ObjStm');
    if (filters.includes('FlateDecode') || filters.includes('Fl')) {
      let data = b.subarray(m.index + m[0].length, end);
      // The data ends before the end-of-line in front of "endstream".
      while (data.length && (data[data.length - 1] === 0x0a || data[data.length - 1] === 0x0d)) data = data.subarray(0, -1);
      // A stream with other filters chained after Flate is not read further; an object stream must be plain Flate.
      const chained = filters.filter((f) => /Decode$/.test(f) && f !== 'FlateDecode').length > 0;
      if (chained && isObjStm) return 'pdf_active';
      if (!chained) {
        const inner = pdfNames(latin1(await inflate(data, budget)));
        if (inner.includes('Encrypt')) return 'pdf_encrypted';
        if (inner.some((n) => PDF_ACTIVE.has(n))) return 'pdf_active';
      }
    } else if (isObjStm) {
      // Objects hidden behind a filter this check does not read: refused.
      return 'pdf_active';
    }
    re.lastIndex = end;
  }
  return null;
}
