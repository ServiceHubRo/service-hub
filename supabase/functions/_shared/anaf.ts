// The company behind a CUI, from ANAF's public register (T25). Pure: the request is built and the
// answer read here, the fetch happens in verify-company. ANAF's answer (API v9):
//   { cod, message, found: [{ date_generale: { cui, denumire, adresa, nrRegCom, stare_inregistrare },
//     inregistrare_scop_Tva: { scpTVA }, stare_inactiv: { statusInactivi, dataRadiere } }], notFound: [cui] }

export const ANAF_URL = 'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva';

export type CompanyStatus = 'active' | 'inactive' | 'deregistered' | 'not_found';

export interface CompanyCheck {
  status: CompanyStatus;
  name: string | null;
  address: string | null;
  vat_payer: boolean | null;
  name_match: boolean | null;
}

/** The digits of a CUI (`RO14872301` → 14872301), or null. */
export function cuiDigits(cui: string): number | null {
  const digits = cui.replace(/^RO/i, '').replace(/\s/g, '');
  return /^\d{2,10}$/.test(digits) ? Number(digits) : null;
}

/** The body ANAF expects: the CUI and the day the answer is about (today, in Bucharest). */
export function anafRequest(cui: number, now: Date = new Date()): [{ cui: number; data: string }] {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(now);
  return [{ cui, data: day }];
}

const LEGAL_FORMS = new Set(['SRL', 'SRLD', 'SA', 'PFA', 'II', 'IF', 'SNC', 'SCS', 'SCA', 'RA', 'SC']);

/** A company name to compare: no diacritics, case, punctuation or legal form ("S.R.L.", "SC"). */
export function normalizeCompanyName(name: string): string {
  const plain = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    // "S.C.", "S.R.L." and "S R L" become SC, SRL before the punctuation goes.
    .replace(/^\s*S\.?\s?C\.?\s/, ' SC ')
    .replace(/\bS\.?\s?R\.?\s?L\.?(\s?-?\s?D\.?)?(?=\s|$)/g, ' SRL ')
    .replace(/\bS\.?\s?A\.?(?=\s|$)/g, ' SA ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  return plain
    .split(' ')
    .filter((w) => w && !LEGAL_FORMS.has(w))
    .join(' ');
}

export function sameCompanyName(a: string | null | undefined, b: string | null | undefined): boolean | null {
  if (!a?.trim() || !b?.trim()) return null;
  return normalizeCompanyName(a) === normalizeCompanyName(b);
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * What ANAF says about one CUI, or null when the answer is not one we understand (the caller then
 * treats ANAF as unavailable and changes nothing).
 */
export function readAnafAnswer(body: unknown, cui: number, legalName: string | null): CompanyCheck | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { found?: unknown; notFound?: unknown };
  const found = Array.isArray(b.found) ? b.found : null;
  const notFound = Array.isArray(b.notFound) ? b.notFound : null;
  if (!found || !notFound) return null;
  const hit = found.find((f) => Number((f as { date_generale?: { cui?: unknown } })?.date_generale?.cui) === cui) as
    | {
        date_generale?: Record<string, unknown>;
        inregistrare_scop_Tva?: { scpTVA?: unknown };
        stare_inactiv?: { statusInactivi?: unknown; dataRadiere?: unknown };
      }
    | undefined;
  if (!hit) {
    return notFound.some((n) => Number(n) === cui)
      ? { status: 'not_found', name: null, address: null, vat_payer: null, name_match: null }
      : null;
  }
  const general = hit.date_generale ?? {};
  const name = text(general.denumire) || null;
  const state = text(general.stare_inregistrare).toUpperCase();
  const deregistered = text(hit.stare_inactiv?.dataRadiere) !== '' || /RADIE|RADIAT/.test(state);
  const status: CompanyStatus = deregistered ? 'deregistered' : hit.stare_inactiv?.statusInactivi === true ? 'inactive' : 'active';
  return {
    status,
    name,
    address: text(general.adresa) || null,
    vat_payer: typeof hit.inregistrare_scop_Tva?.scpTVA === 'boolean' ? hit.inregistrare_scop_Tva.scpTVA : null,
    name_match: sameCompanyName(name, legalName),
  };
}
