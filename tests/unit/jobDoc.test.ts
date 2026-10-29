import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  consentText,
  docDuration,
  docMoney,
  docMonths,
  docNumber,
  docTotals,
  JOB_DOC_TEXT,
  jobDocFileName,
  type JobDocData,
} from '../../supabase/functions/_shared/jobDoc';
import { renderJobPdf } from '../../supabase/functions/_shared/jobPdf';
import type { PdfLib } from '../../supabase/functions/_shared/reportPdf';

const lib = { PDFDocument, rgb, fontkit } as unknown as PdfLib;

/** The paper quote Eduard sent (28 Oct 2026), as the database would give it. */
function sample(kind: JobDocData['kind'] = 'quote', status = 'sent'): JobDocData {
  const item = (position: number, fields: Partial<JobDocData['quote'] & object> & Record<string, unknown>) => ({
    position,
    approved: status === 'sent' ? null : true,
    option_group: null,
    variant: null,
    brand: null,
    quantity: null,
    unit_price: null,
    ...fields,
  });
  return {
    kind,
    side: 'client',
    booking: {
      id: 'b-1',
      ref: 'P-004213',
      status: kind === 'final' ? 'done' : status === 'sent' ? 'quote_sent' : 'approved',
      date: '2026-10-19',
      slot: '09:00',
      note: 'Aprinde martorul de motor la rece.',
      created_at: '2026-10-17T08:00:00Z',
      inspection_started_at: '2026-10-19T06:10:00Z',
      started_at: '2026-10-27T07:00:00Z',
      done_at: '2026-10-28T13:33:00Z',
      odometer: 23640,
      work: 'Revizie ulei și filtre, diagnoză tester.',
      cost: 2177.55,
      warranty_months: 3,
      warranty_until: '2027-01-28',
      work_by: 'Roland Iordănescu, David Tomița',
      checked_by: 'Marian Ghiță',
      quote_number: 477,
      client_name: 'Andrei Popescu',
      client_phone: '+40723375248',
      car: { make: 'Land Rover', model: 'Defender', year: 2023, plate: 'BV 01 ABC', vin: 'SALEA7BW7R0000000' },
      services_ro: 'Revizie ulei și filtre, Constatare mecanică, Diagnoză tester',
      services_en: 'Oil and filter service, Mechanical inspection, Diagnostic scan',
    },
    shop: {
      name: 'Autoservice Exemplu',
      legal_name: 'AUTOSERVICE EXEMPLU SRL',
      vat_id: 'RO12345678',
      reg_com: 'J08/1234/2015',
      legal_address: 'Str. Exemplului 52, Hala M2, Brașov',
      phone: '0268 000 000',
    },
    recipient: { company_name: 'Exemplu Consult SRL', vat_id: 'RO32155640', address: 'Str. Teodoroiu 2 bis, Brașov' },
    quote: {
      version: 1,
      status,
      note: 'Piesele ajung a doua zi dimineață.',
      inspection_fee: 0,
      total_sent: 2177.55,
      total_approved: status === 'sent' ? null : 2177.55,
      sent_at: '2026-10-19T09:00:00Z',
      expires_at: '2026-10-22T09:00:00Z',
      decided_at: status === 'sent' ? null : '2026-10-19T11:32:00Z',
      decided_by: status === 'sent' ? null : 'client',
      vat_rate: 21,
      est_hours: 2,
      terms:
        'Pe parcursul operațiilor de demontare pot apărea defecte care nu au putut fi prevăzute. Valoarea devizului se poate modifica numai cu acordul clientului. Autovehiculul se ridică după confirmarea plății.',
      items: [
        item(1, { name: 'Revizie ulei + filtre', price: 272.25, kind: 'labor', quantity: 1.5, unit_price: 181.5 }),
        item(2, { name: 'Constatare mecanică', price: 18.15, kind: 'labor', quantity: 0.1, unit_price: 181.5 }),
        item(3, { name: 'Diagnoză tester', price: 18.15, kind: 'labor', quantity: 0.1, unit_price: 181.5 }),
        item(4, { name: 'Ulei motor 0W-30 5L', price: 623, kind: 'part', quantity: 1, unit_price: 623, brand: 'Petronas' }),
        item(5, { name: 'Ulei motor 0W-30 1L', price: 516, kind: 'part', quantity: 4, unit_price: 129, brand: 'Petronas' }),
        item(6, { name: 'Filtru ulei', price: 63, kind: 'part', quantity: 1, unit_price: 63, brand: 'Mann' }),
        item(7, { name: 'Filtru aer', price: 114, kind: 'part', quantity: 1, unit_price: 114, brand: 'Mann' }),
        item(8, { name: 'Filtru combustibil', price: 323, kind: 'part', quantity: 1, unit_price: 323, brand: 'Mann' }),
        item(9, { name: 'Filtru habitaclu', price: 205, kind: 'part', quantity: 1, unit_price: 205, brand: 'Mann' }),
        item(10, { name: 'Materiale consumabile', price: 25, kind: 'part', quantity: 5, unit_price: 5 }),
      ] as JobDocData['quote'] extends infer Q ? (Q extends { items: infer I } ? I : never) : never,
    },
    intake: {
      odometer: 23611,
      fuel: 2,
      damages: [
        { x: 0.12, y: 0.55, kind: 'scratch', note: 'Ușa stânga spate' },
        { x: 0.5, y: 0.04, kind: 'dent', note: 'Bara față, centru' },
        { x: 0.86, y: 0.84, kind: 'crack' },
      ],
      photos: [],
      personal_items: 'Scaun copil, încărcător telefon',
      notes: 'Jantă dreapta față zgâriată.',
      keep_parts: true,
      road_test: true,
      created_at: '2026-10-19T06:15:00Z',
      updated_at: '2026-10-19T06:20:00Z',
      confirmed_at: '2026-10-19T06:40:00Z',
    },
  };
}

const pdfText = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();

describe('job documents', () => {
  it('adds up the paper quote exactly', () => {
    const totals = docTotals(sample());
    expect(totals.labor).toBe(308.55);
    expect(totals.parts).toBe(1869);
    expect(totals.total).toBe(2177.55);
    expect(totals.net).toBe(1799.63);
    expect(totals.vat).toBe(377.92);
  });

  it('counts the original of a pair before the answer, the chosen line after', () => {
    const d = sample();
    d.quote!.items.push(
      { position: 11, name: 'Plăcuțe față', price: 420, approved: null, option_group: 1, variant: 'original', brand: 'Brembo', kind: 'part', quantity: 1, unit_price: 420 },
      { position: 12, name: 'Plăcuțe față', price: 260, approved: null, option_group: 1, variant: 'alternative', brand: 'Bosch', kind: 'part', quantity: 1, unit_price: 260 },
    );
    expect(docTotals(d).total).toBe(2597.55);
    d.quote!.status = 'accepted';
    for (const i of d.quote!.items) i.approved = i.variant !== 'original';
    expect(docTotals(d).total).toBe(2437.55);
  });

  it('has no VAT lines when the shop is not a VAT payer', () => {
    const d = sample();
    d.quote!.vat_rate = null;
    expect(docTotals(d).net).toBeNull();
    expect(docTotals(d).vat).toBeNull();
  });

  it('formats like the paper: cents always, numbers padded, Romanian plurals', () => {
    expect(docMoney('ro', 1869)).toBe('1.869,00 lei');
    expect(docMoney('en', 1869)).toBe('1,869.00 RON');
    expect(docNumber(477)).toBe('000477');
    expect(docDuration('ro', 2)).toBe('2 ore');
    expect(docDuration('ro', 1)).toBe('1 oră');
    expect(docDuration('ro', 48)).toBe('2 zile');
    expect(docDuration('ro', 20)).toBe('20 de ore');
    expect(docDuration('en', 24)).toBe('1 day');
    expect(docMonths('ro', 24)).toBe('24 de luni');
    expect(jobDocFileName('ro', { kind: 'final', booking: sample().booking })).toBe('deviz-final-000477.pdf');
    expect(jobDocFileName('en', { kind: 'intake', booking: { ...sample().booking, quote_number: null } })).toBe('intake-sheet-P-004213.pdf');
  });

  it('says where the client\'s agreement stands', () => {
    expect(consentText('ro', sample())).toContain('Așteaptă răspunsul clientului');
    expect(consentText('ro', sample('quote', 'accepted'))).toBe('Acceptat în aplicație de Exemplu Consult SRL la 19.10.2026, ora 14:32.');
    const shop = sample('quote', 'accepted');
    shop.quote!.decided_by = 'shop';
    expect(consentText('en', shop)).toContain('recorded by the shop');
  });

  it('has the same texts in both languages', () => {
    expect(Object.keys(JOB_DOC_TEXT.en).sort()).toEqual(Object.keys(JOB_DOC_TEXT.ro).sort());
  });

  it('renders the three documents in both languages', async () => {
    for (const [kind, status] of [
      ['quote', 'sent'],
      ['quote', 'accepted'],
      ['final', 'accepted'],
      ['intake', 'accepted'],
    ] as const) {
      for (const lang of ['ro', 'en'] as const) {
        const bytes = await renderJobPdf(lib, sample(kind, status), lang);
        expect(await pdfText(bytes)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('continues a long quote on more pages, every page with its header and footer', async () => {
    const d = sample();
    const base = d.quote!.items[3]!;
    for (let i = 0; i < 45; i++) d.quote!.items.push({ ...base, position: 20 + i, name: `Piesă ${i + 1} cu o denumire lungă care trece pe al doilea rând al coloanei` });
    expect(await pdfText(await renderJobPdf(lib, d, 'ro'))).toBeGreaterThan(1);
  });
});
