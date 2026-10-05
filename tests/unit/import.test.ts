import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeText, ImportFileError, parseCsv, readTable, readXlsx } from '../../src/lib/importFile';
import { checkRows, chunks, guessMapping, importAmount, importDay, importOdometer, importPhone } from '../../src/lib/importRows';
import { toXlsx } from '../../src/lib/xlsx';

// T31a: reading another program's export and cleaning what it holds.

describe('reading the file', () => {
  it('reads a CSV with any separator, quotes and line breaks inside', () => {
    expect(parseCsv('Nume;Telefon\r\n"Pop; Ion";0722 111 222\n')).toEqual([
      ['Nume', 'Telefon'],
      ['Pop; Ion', '0722 111 222'],
    ]);
    expect(parseCsv('a,b,c\n1,"x ""y""",3')).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x "y"', '3'],
    ]);
    expect(parseCsv('a\tb\n"line\nbreak"\t2')).toEqual([
      ['a', 'b'],
      ['line\nbreak', '2'],
    ]);
  });

  it('reads UTF-8 (with or without BOM) and the Windows encoding of Romanian Excel', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Mașină')]))).toBe('Mașină');
    // "Braºov" as Windows-1250 bytes: ș is 0xBA there.
    expect(decodeText(new Uint8Array([0x42, 0x72, 0x61, 0xba, 0x6f, 0x76]))).toBe('Brașov');
  });

  it('reads the first sheet of an .xlsx, shared strings, inline strings, numbers and gaps', async () => {
    const blob = toXlsx(
      [
        ['Nume', 'Telefon', 'Km'],
        ['Ion Pop', '0722111222', '105400'],
      ],
      'Clienți',
    );
    const rows = readXlsx(new Uint8Array(await blob.arrayBuffer()));
    expect(rows[0]).toEqual(['Nume', 'Telefon', 'Km']);
    expect(rows[1]).toEqual(['Ion Pop', '0722111222', '105400']);

    // A sheet written by another program: shared strings, a gap (B empty), a date number.
    const sheet =
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Data</t></is></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2"><v>45365</v></c></row></sheetData></worksheet>';
    const zip = zipSync({
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>Nume</t></si><si><r><t>Maria </t></r><r><t>Ene &amp; fiul</t></r></si></sst>'),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
    });
    expect(readXlsx(zip)).toEqual([
      ['Nume', '', 'Data'],
      ['Maria Ene & fiul', '', '45365'],
    ]);
  });

  it('says what is wrong with a file it cannot read', async () => {
    await expect(readTable(new Blob([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])]))).rejects.toEqual(
      new ImportFileError('old_excel'),
    );
    await expect(readTable(new Blob(['\n ; \n']))).rejects.toEqual(new ImportFileError('empty'));
    await expect(readTable(new Blob([new Uint8Array([0x50, 0x4b, 1, 2, 3])]))).rejects.toEqual(new ImportFileError('unreadable'));
  });
});

describe('what the values mean', () => {
  it('guesses the columns from the header, in Romanian or English', () => {
    expect(
      guessMapping([
        'Nume client',
        'Tel.',
        'E-mail',
        'Marcă',
        'Model',
        'An fabricație',
        'Nr. înmatriculare',
        'Serie șasiu',
        'Data',
        'Lucrare',
        'Km',
        'Total (lei)',
      ]),
    ).toEqual({
      name: 0,
      phone: 1,
      email: 2,
      make: 3,
      model: 4,
      year: 5,
      plate: 6,
      vin: 7,
      day: 8,
      work: 9,
      odometer: 10,
      cost: 11,
    });
    expect(guessMapping(['Customer', 'Phone', 'Car', 'License plate', 'Date', 'Description', 'Mileage', 'Amount'])).toEqual({
      name: 0,
      phone: 1,
      make: 2,
      plate: 3,
      day: 4,
      work: 5,
      odometer: 6,
      cost: 7,
    });
    expect(guessMapping(['Pantofi', 'Culoare'])).toEqual({});
  });

  it('reads phones the way people write them', () => {
    expect(importPhone('0722 111 222')).toBe('+40722111222');
    expect(importPhone('+40 722-111-222')).toBe('+40722111222');
    expect(importPhone('0040722111222')).toBe('+40722111222');
    expect(importPhone('722111222')).toBe('+40722111222');
    expect(importPhone('40268111222')).toBe('+40268111222');
    expect(importPhone('+49 151 23456789')).toBe('+4915123456789');
    expect(importPhone('0722')).toBeNull();
    expect(importPhone('0822111222')).toBeNull();
  });

  it('reads days in the usual formats, day first', () => {
    expect(importDay('14.03.2024')).toBe('2024-03-14');
    expect(importDay('14/03/2024 10:30')).toBe('2024-03-14');
    expect(importDay('2024-03-14T08:00:00')).toBe('2024-03-14');
    expect(importDay('03/25/2024')).toBe('2024-03-25');
    expect(importDay('5-1-21')).toBe('2021-01-05');
    expect(importDay('45365')).toBe('2024-03-14');
    expect(importDay('31.02.2024')).toBeNull();
    expect(importDay('ieri')).toBeNull();
  });

  it('reads amounts and kilometers', () => {
    expect(importAmount('1.250,50 lei')).toBe(1250.5);
    expect(importAmount('1,250.50')).toBe(1250.5);
    expect(importAmount('350')).toBe(350);
    expect(importAmount('350,5')).toBe(350.5);
    expect(importAmount('RON 1 250')).toBe(1250);
    expect(importAmount('1.250')).toBe(1250);
    expect(importAmount('12.5')).toBe(12.5);
    expect(importAmount('gratuit')).toBeNull();
    expect(importAmount('-20')).toBeNull();
    expect(importOdometer('105.400 km')).toBe(105400);
    expect(importOdometer('105 400')).toBe(105400);
    expect(importOdometer('mult')).toBeNull();
    expect(importOdometer('3000000')).toBeNull();
  });
});

describe('checking the rows', () => {
  const header = ['Nume', 'Telefon', 'Mașina', 'Nr', 'Data', 'Lucrare', 'Km', 'Suma'];
  const mapping = guessMapping(header);

  it('keeps clients, cars and jobs; leaves out what cannot be read; skips what cannot be kept', () => {
    const check = checkRows(
      [
        header,
        ['Ion Pop', '0722 111 222', 'Dacia Logan', 'bv 01 ion', '10.03.2024', 'Schimb ulei', '120.500', '350,50'],
        ['Ion Pop', '0722111222', 'Dacia Logan', 'BV-01-ION', '01.02.2025', 'Frâne', '', '420'],
        ['Maria Ene', '12', 'Skoda', '', '', '', '', ''],
        ['', '', '', '', '', '', '', ''],
        ['Vasile', '', '', '', 'mâine', 'x', '', ''],
        ['', '', '', '', '', 'doar o lucrare', '', ''],
        ['Ana', '', '', '', '', 'fără dată', '', '100'],
        ['Dan', '', '', '', '01.01.2099', 'viitor', '', ''],
      ],
      mapping,
      '2026-10-05',
    );
    expect(check.rows[0]).toEqual({
      row: 2,
      name: 'Ion Pop',
      phone: '+40722111222',
      make: 'Dacia',
      model: 'Logan',
      plate: 'BV 01 ION',
      day: '2024-03-10',
      work: 'Schimb ulei',
      odometer: 120500,
      cost: 350.5,
    });
    // A wrong phone is left out, the client still comes in.
    expect(check.rows[2]).toEqual({ row: 4, name: 'Maria Ene', make: 'Skoda' });
    // A job without its day: the client comes in without the job.
    expect(check.rows.find((r) => r.row === 8)).toEqual({ row: 8, name: 'Ana' });
    expect(check.skipped).toEqual([
      { row: 6, problem: 'day' },
      { row: 7, problem: 'empty' },
      { row: 9, problem: 'day' },
    ]);
    expect(check.ignored).toBe(2);
    expect(check).toMatchObject({ clients: 3, cars: 2, jobs: 2 });
  });

  it('splits the rows for the database', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
