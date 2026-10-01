import { describe, expect, it } from 'vitest';
import {
  anafRequest,
  cuiDigits,
  normalizeCompanyName,
  readAnafAnswer,
  sameCompanyName,
} from '../../supabase/functions/_shared/anaf.ts';
import { tokenAal } from '../../supabase/functions/_shared/jwt.ts';

/** An ANAF v9 answer for one company, as the register writes it. */
function found(general: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    cod: 200,
    message: 'SUCCESS',
    found: [
      {
        date_generale: {
          cui: 14872301,
          data: '2026-10-01',
          denumire: 'AUTO UNU S.R.L.',
          adresa: 'JUD. BRAŞOV, MUN. BRAŞOV, STR. LUNGĂ, NR.1',
          nrRegCom: 'J08/1245/2009',
          stare_inregistrare: 'INREGISTRAT din data 12.05.2009',
          ...general,
        },
        inregistrare_scop_Tva: { scpTVA: true, perioade_TVA: [] },
        stare_inactiv: { dataInactivare: '', dataReactivare: '', dataPublicare: '', dataRadiere: '', statusInactivi: false },
        ...extra,
      },
    ],
    notFound: [],
  };
}

describe('ANAF (T25)', () => {
  it('asks about the digits of the CUI, for today in Bucharest', () => {
    expect(cuiDigits('RO14872301')).toBe(14872301);
    expect(cuiDigits('160796')).toBe(160796);
    expect(cuiDigits('RO')).toBeNull();
    // 23:30 UTC on 30 Sept is already 1 Oct in Bucharest.
    expect(anafRequest(14872301, new Date('2026-09-30T23:30:00Z'))).toEqual([{ cui: 14872301, data: '2026-10-01' }]);
  });

  it('compares names without diacritics, punctuation or the legal form', () => {
    expect(normalizeCompanyName('S.C. Auto Unu S.R.L.')).toBe('AUTO UNU');
    expect(sameCompanyName('AUTO UNU S.R.L.', 'Auto Unu SRL')).toBe(true);
    expect(sameCompanyName('ŞTEFĂNESCU SERVICE SRL', 'Ștefănescu Service S.R.L.')).toBe(true);
    expect(sameCompanyName('AUTO UNU SRL', 'AUTO DOI SRL')).toBe(false);
    expect(sameCompanyName('AUTO UNU SRL', '')).toBeNull();
  });

  it('reads an active company, its name, address and VAT', () => {
    expect(readAnafAnswer(found({}), 14872301, 'Auto Unu SRL')).toEqual({
      status: 'active',
      name: 'AUTO UNU S.R.L.',
      address: 'JUD. BRAŞOV, MUN. BRAŞOV, STR. LUNGĂ, NR.1',
      vat_payer: true,
      name_match: true,
    });
    expect(readAnafAnswer(found({}), 14872301, 'Alt Nume SRL')!.name_match).toBe(false);
  });

  it('inactive, deregistered and unknown companies', () => {
    const inactive = found({}, { stare_inactiv: { statusInactivi: true, dataRadiere: '' } });
    expect(readAnafAnswer(inactive, 14872301, null)!.status).toBe('inactive');
    const gone = found({}, { stare_inactiv: { statusInactivi: true, dataRadiere: '2024-03-01' } });
    expect(readAnafAnswer(gone, 14872301, null)!.status).toBe('deregistered');
    expect(readAnafAnswer(found({ stare_inregistrare: 'RADIERE din data 01.03.2024' }), 14872301, null)!.status).toBe('deregistered');
    expect(readAnafAnswer({ cod: 200, found: [], notFound: [14872301] }, 14872301, 'X')).toEqual({
      status: 'not_found',
      name: null,
      address: null,
      vat_payer: null,
      name_match: null,
    });
  });

  it('an answer it does not understand changes nothing', () => {
    expect(readAnafAnswer(null, 1, null)).toBeNull();
    expect(readAnafAnswer({ cod: 404, message: 'Not found' }, 1, null)).toBeNull();
    expect(readAnafAnswer({ found: [], notFound: [] }, 14872301, null)).toBeNull();
  });

  it('reads the level of a session from its token', () => {
    const token = (payload: object) => `x.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.y`;
    expect(tokenAal(token({ sub: 'u', aal: 'aal2' }))).toBe('aal2');
    expect(tokenAal(token({ sub: 'u', aal: 'aal1' }))).toBe('aal1');
    expect(tokenAal(token({ sub: 'u' }))).toBe('aal1');
    expect(tokenAal('garbage')).toBe('aal1');
    expect(tokenAal(null)).toBe('aal1');
  });
});
