import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { myDataSheets, when } from '../../src/lib/myData';
import { toXlsxBook } from '../../src/lib/xlsx';

const client = {
  format: 'service-hub-export/1',
  exported_at: '2026-10-10T06:06:00Z',
  account: {
    account_id: 'C-00002',
    role: 'client',
    name: 'Maria Pop',
    phone: '+40740450585',
    email: 'maria@example.com',
    language: 'ro',
    email_verified_at: '2026-10-01T08:00:00Z',
    phone_verified_at: null,
    terms_version: '2026-10-09',
    terms_accepted_at: '2026-10-01T08:00:00Z',
    created_at: '2026-10-01T08:00:00Z',
  },
  cars: [{ make: 'Dacia', model: 'Logan', year: 2019, plate: 'BV 11 MSG', vin: null, itp_expiry: '2027-03-01', rca_expiry: null, vignette_expiry: null, created_at: '2026-10-01T08:05:00Z' }],
  favorites: [],
  bookings: [
    {
      ref: 'P-000006',
      shop: 'Atelier Demo',
      service_id: 'frane',
      extra_service_ids: ['ulei'],
      date: '2026-10-12',
      slot: '12:00:00',
      status: 'quote_sent',
      car_snapshot: { make: 'Dacia', model: 'Logan', year: 2019, plate: 'BV 11 MSG' },
      odometer: null,
      cost: null,
      note: 'Scârțâie la frânare',
      created_at: '2026-10-04T09:52:00Z',
      quotes: [
        {
          version: 1,
          status: 'sent',
          inspection_fee: 50,
          sent_at: '2026-10-04T10:00:00Z',
          decided_at: null,
          items: [{ name: 'Plăcuțe față', price: 300, approved: null }],
        },
      ],
    },
  ],
  reviews: [],
  messages: [
    { conversation_with: 'Atelier Demo', from: 'system', text: null, event: 'booking_confirmed', params: { ref: 'P-000006', date: '2026-10-12', slot: '12:00' }, sent_at: '2026-10-04T09:53:00Z' },
    { conversation_with: 'Atelier Demo', from: 'me', text: 'Mai costați mult sau puțin?', event: null, params: null, sent_at: '2026-10-10T05:58:00Z' },
  ],
  history_reports: [],
  invited_with_code: null,
  friends_invited: 0,
  report_credits: [],
  area_waitlist: null,
};

const services = new Map([
  ['frane', { name_ro: 'Frâne', name_en: 'Brakes' }],
  ['ulei', { name_ro: 'Schimb ulei', name_en: 'Oil change' }],
]);

describe('Descarcă datele mele', () => {
  it('dates and times in Romanian time, in the reader’s format', () => {
    expect(when('ro', '2026-10-10T06:06:00Z')).toBe('10.10.2026, 09:06');
    expect(when('en', '2026-10-10T06:06:00Z')).toBe('10/10/2026, 09:06');
    expect(when('ro', '2027-03-01')).toBe('01.03.2027');
    expect(when('ro', null)).toBe('');
  });

  it('one readable sheet per kind of data, empty kinds left out', () => {
    const sheets = myDataSheets(client, 'ro', services);
    expect(sheets.map((s) => s.name)).toEqual(['Cont', 'Mașini', 'Programări', 'Devize', 'Mesaje']);
    const account = Object.fromEntries(sheets[0]!.rows.slice(1).map(([k, v]) => [k, v]));
    expect(account).toMatchObject({ 'Cod cont': 'C-00002', 'Tip cont': 'Client', Limba: 'Română', 'Cont creat': '01.10.2026, 11:00' });
    expect(account).not.toHaveProperty('Telefon confirmat');

    const [header, booking] = sheets[2]!.rows;
    expect(header).toContain('Serviciu');
    expect(booking).toEqual(expect.arrayContaining(['P-000006', 'Atelier Demo', 'Frâne, Schimb ulei', '12.10.2026', '12:00', 'Deviz trimis', 'Dacia Logan 2019', 'BV 11 MSG']));

    const quotes = sheets[3]!.rows.slice(1);
    expect(quotes[0]).toEqual(['P-000006', '1', 'Trimis', 'Plăcuțe față', '300', '', '04.10.2026, 13:00', '']);
    expect(quotes[1]![3]).toBe('Taxă de constatare');

    const messages = sheets[4]!.rows.slice(1);
    expect(messages[0]![2]).toBe('Mesaj automat');
    expect(messages[0]![3]).toContain('Programarea P-000006 este confirmată');
    expect(messages[1]).toEqual(['10.10.2026, 08:58', 'Atelier Demo', 'Eu', 'Mai costați mult sau puțin?']);
  });

  it('in English for an English reader; a missing service name shows its code', () => {
    const sheets = myDataSheets(client, 'en', new Map());
    expect(sheets.map((s) => s.name)).toEqual(['Account', 'Cars', 'Bookings', 'Quotes', 'Messages']);
    expect(sheets[2]!.rows[1]).toEqual(expect.arrayContaining(['frane, ulei', 'Quote sent']));
  });

  it('a shop owner also gets the shop, its hours and invoices', () => {
    const shop = {
      ...client,
      account: { ...client.account, role: 'shop', account_id: 'S-00001' },
      cars: [],
      bookings: [],
      messages: [],
      shop: {
        name: 'Atelier Demo',
        city: 'Brașov',
        my_role: 'owner',
        services: ['frane'],
        hours: [
          { weekday: 1, closed: false, open: '08:00:00', close: '17:00:00' },
          { weekday: 0, closed: true, open: null, close: null },
        ],
        closures: [],
        billing: { legal_name: 'Demo SRL', vat_id: 'RO123', vat_payer: false },
        subscription: { status: 'trial', trial_ends_at: '2026-12-30T22:00:00Z', current_period_end: null, price_ron: 99 },
        invoices: [{ series: 'SH', number: 7, amount: 99, vat_amount: 0, currency: 'RON', issued_at: '2026-10-01T09:00:00Z', status: 'paid' }],
      },
    };
    const sheets = myDataSheets(shop, 'ro', services);
    expect(sheets.map((s) => s.name)).toEqual(['Cont', 'Service', 'Program', 'Facturi']);
    const facts = Object.fromEntries(sheets[1]!.rows.slice(1).map(([k, v]) => [k, v]));
    expect(facts).toMatchObject({ 'Rolul meu': 'Proprietar', 'Servicii oferite': 'Frâne', 'Plătitor de TVA': 'Nu', Abonament: 'Perioadă gratuită' });
    expect(sheets[2]!.rows.slice(1)).toEqual([
      ['Luni', '08:00–17:00'],
      ['Duminică', 'Închis'],
    ]);
    expect(sheets[3]!.rows[1]).toEqual(['SH 7', '99', '0', 'RON', '01.10.2026, 12:00', 'Plătită']);
  });

  it('the Excel file holds every sheet, each with its own name', async () => {
    const blob = toXlsxBook(myDataSheets(client, 'ro', services));
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const book = strFromU8(files['xl/workbook.xml']!);
    expect(book.match(/<sheet /g)).toHaveLength(5);
    expect(book).toContain('<sheet name="Mașini" sheetId="2" r:id="rId2"/>');
    expect(strFromU8(files['xl/_rels/workbook.xml.rels']!)).toContain('Id="rId6"');
    expect(strFromU8(files['xl/worksheets/sheet5.xml']!)).toContain('Mai costați mult sau puțin?');
    expect(strFromU8(files['[Content_Types].xml']!)).toContain('/xl/worksheets/sheet5.xml');
  });
});
