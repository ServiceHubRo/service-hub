import { strFromU8, unzipSync } from 'fflate';

/**
 * Reading the file a shop brings from another program (T31a): a CSV (any of `,` `;` or tab, in
 * UTF-8 or the Windows encoding Romanian Excel often saves in) or an Excel workbook (.xlsx, the
 * first sheet). Everything comes out as rows of text; what each column means is decided later
 * (`importRows.ts`). Read in the browser: the file itself never leaves the device.
 */

export class ImportFileError extends Error {
  constructor(public readonly code: 'unreadable' | 'old_excel' | 'empty') {
    super(code);
  }
}

/** The rows of a CSV or .xlsx file, the empty rows left out. */
export async function readTable(file: Blob & { name?: string }): Promise<string[][]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let rows: string[][];
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) rows = readXlsx(bytes);
  // The old binary Excel format (.xls): it has to be saved again as .xlsx or CSV.
  else if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new ImportFileError('old_excel');
  else rows = parseCsv(decodeText(bytes));
  const kept = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (kept.length === 0) throw new ImportFileError('empty');
  return kept;
}

/**
 * UTF-8 when it is valid UTF-8, else Windows-1250 (Central European, Romanian Excel's CSV). The
 * old cedilla letters (ş ţ) become the correct comma-below ones (ș ț).
 */
export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1250').decode(bytes);
  }
  return text.replace(/^\uFEFF/, '').replace(/[\u015F\u0163\u015E\u0162]/g, (c) => CEDILLA[c]!);
}

const CEDILLA: Record<string, string> = { '\u015F': '\u0219', '\u0163': '\u021B', '\u015E': '\u0218', '\u0162': '\u021A' };

/** The separator the first line uses most, outside quotes: `;`, `,` or tab. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = -1;
  for (const d of [';', ',', '\t']) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180: quoted fields may hold the separator, line breaks and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const d = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === d) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e.startsWith('#x')
      ? String.fromCodePoint(parseInt(e.slice(2), 16))
      : e.startsWith('#')
        ? String.fromCodePoint(Number(e.slice(1)))
        : XML_ENTITIES[e]!,
  );
}

/** The text of every `<t>` inside a piece of XML (a shared string with formatting runs has several). */
function textOf(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]!)).join('');
}

/** `B12` → column 1. */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The first sheet of an .xlsx workbook. Numbers come as Excel writes them (a date is a day count). */
export function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) =>
        f.name === 'xl/workbook.xml' ||
        f.name === 'xl/_rels/workbook.xml.rels' ||
        f.name === 'xl/sharedStrings.xml' ||
        f.name.startsWith('xl/worksheets/'),
    });
  } catch {
    throw new ImportFileError('unreadable');
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : '');

  // The first sheet in the workbook's order, through its relationship id.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const firstSheet = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(text('xl/workbook.xml'));
  if (firstSheet) {
    const rel =
      new RegExp(`<Relationship\\b[^>]*\\bId="${firstSheet[1]}"[^>]*\\bTarget="([^"]+)"`).exec(
        text('xl/_rels/workbook.xml.rels'),
      ) ??
      new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${firstSheet[1]}"`).exec(
        text('xl/_rels/workbook.xml.rels'),
      );
    if (rel) sheetPath = rel[1]!.startsWith('/') ? rel[1]!.slice(1) : `xl/${rel[1]!.replace(/^\.\//, '')}`;
  }
  const sheet = text(sheetPath);
  if (!sheet) throw new ImportFileError('unreadable');

  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));

  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cell of rowMatch[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1]!;
      const body = cell[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) value = unescapeXml(v);
      const index = ref ? columnIndex(ref) : row.length;
      while (row.length < index) row.push('');
      row[index] = value;
    }
    rows.push(row);
  }
  return rows;
}
