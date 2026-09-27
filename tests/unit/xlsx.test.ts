import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { cellNumber, columnName, toXlsx } from '../../src/lib/xlsx';

async function sheetOf(blob: Blob): Promise<string> {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return strFromU8(files['xl/worksheets/sheet1.xml']!);
}

describe('Excel export', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });

  it('keeps phones, codes and leading zeros as text; amounts and counts as numbers', () => {
    expect(cellNumber('105400')).toBe(105400);
    expect(cellNumber('340,50')).toBe(340.5);
    expect(cellNumber('79.5')).toBe(79.5);
    expect(cellNumber('0')).toBe(0);
    for (const text of ['+40740450585', '0740450585', '050123', 'P-000123', 'C-00002', '2026-09-27 15:33', '', '1.250,50']) {
      expect(cellNumber(text), text).toBeNull();
    }
  });

  it('a bold, frozen header with a filter on every column; text never becomes a formula', async () => {
    const sheet = await sheetOf(
      toXlsx(
        [
          ['Cont', 'Nume', 'Telefon', 'Sumă'],
          ['C-00002', '=HYPERLINK("x")', '+40740450585', '340,50'],
        ],
        'Clienți',
      ),
    );
    expect(sheet).toContain('<autoFilter ref="A1:D2"/>');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1">');
    expect(sheet).toContain('<t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t>');
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('<t xml:space="preserve">+40740450585</t>');
    expect(sheet).toContain('<c r="D2"><v>340.5</v></c>');
  });
});
