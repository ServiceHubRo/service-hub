import { strToU8, zipSync } from 'fflate';

/**
 * A spreadsheet file (.xlsx) from rows of text: the first row is the header, in bold, frozen at
 * the top, with a filter on every column; widths follow the content. Excel, LibreOffice, Numbers
 * and Google Sheets open it in columns whatever the computer's language (a CSV splits on `,` or
 * `;` depending on it, so it often landed in one column). Whole numbers and amounts become number
 * cells (sums, sorting); everything else stays text, never a formula.
 */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Text safe inside XML (and without the control characters XML forbids). */
function esc(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A1-style column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/**
 * The number a cell holds, or null for text. `105400`, `340,50`, `340.5`, `-12` are numbers;
 * `0740…` (a leading zero: phones, postal codes), `+40…`, codes and dates stay text.
 */
export function cellNumber(value: string): number | null {
  if (!/^-?(0|[1-9]\d{0,14})([.,]\d{1,6})?$/.test(value)) return null;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function cell(ref: string, value: string, header: boolean): string {
  if (value === '') return '';
  const n = header ? null : cellNumber(value);
  if (n !== null) return `<c r="${ref}"><v>${n}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function sheetXml(rows: readonly (readonly string[])[]): string {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const last = `${columnName(width - 1)}${Math.max(1, rows.length)}`;
  const cols = Array.from({ length: width }, (_, i) => {
    const longest = Math.max(4, ...rows.slice(0, 500).map((r) => (r[i] ?? '').length));
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, longest + 3)}" customWidth="1"/>`;
  }).join('');
  const body = rows
    .map((r, y) => `<row r="${y + 1}">${r.map((v, x) => cell(`${columnName(x)}${y + 1}`, v, y === 0)).join('')}</row>`)
    .join('');
  return (
    XML_HEAD +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols><sheetData>${body}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>` +
    '</worksheet>'
  );
}

export interface XlsxSheet {
  name: string;
  rows: readonly (readonly string[])[];
}

export function toXlsx(rows: readonly (readonly string[])[], sheetName: string): Blob {
  return toXlsxBook([{ name: sheetName, rows }]);
}

/** Excel: at most 31 characters, none of []:*?/\, each name once in the file. */
function sheetNames(sheets: readonly XlsxSheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((sheet, i) => {
    const base = sheet.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** A file with one sheet per entry, in order (the first one opens). */
export function toXlsxBook(sheets: readonly XlsxSheet[]): Blob {
  const names = sheetNames(sheets);
  const sheetType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
  const relType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const filters = sheets
    .map(({ rows }, i) => {
      const width = Math.max(1, ...rows.map((r) => r.length));
      const range = `'${names[i]!.replace(/'/g, "''")}'!$A$1:$${columnName(width - 1)}$${Math.max(1, rows.length)}`;
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(range)}</definedName>`;
    })
    .join('');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${sheetType}"/>`).join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${relType}/officeDocument" Target="xl/workbook.xml"/>` +
        '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      XML_HEAD +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${relType}">` +
        `<sheets>${names.map((name, i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
        `<definedNames>${filters}</definedNames>` +
        '</workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${relType}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="${relType}/styles" Target="styles.xml"/>` +
        '</Relationships>',
    ),
    'xl/styles.xml': strToU8(
      XML_HEAD +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>',
    ),
  };
  sheets.forEach(({ rows }, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(rows));
  });
  return new Blob([zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
