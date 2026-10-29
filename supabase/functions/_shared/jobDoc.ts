// The documents of a job (T50): the quote, the final quote and the intake sheet, as the PDF prints
// them, in the reader's language. No Deno and no npm here, so the unit tests load it; the drawing
// is in jobPdf.ts. The figures follow the quote as stored: every price includes VAT when the quote
// has a VAT rate, and the VAT is worked out of the total.
import type { DamageKind, DamageMark } from './carDiagram.ts';
import { formatTime, type Lang } from './format.ts';

export type { Lang };

export type JobDocKind = 'quote' | 'final' | 'intake';

export interface JobDocItem {
  position: number;
  name: string;
  price: number;
  approved: boolean | null;
  option_group: number | null;
  variant: 'original' | 'alternative' | null;
  brand: string | null;
  kind: 'labor' | 'part' | null;
  quantity: number | null;
  unit_price: number | null;
}

export interface JobDocParty {
  name?: string;
  street?: string;
  city?: string;
  county?: string;
  phone?: string;
  legal_name?: string;
  vat_id?: string;
  reg_com?: string;
  legal_address?: string;
}

export interface JobDocData {
  kind: JobDocKind;
  side: 'client' | 'shop' | 'admin';
  booking: {
    id: string;
    ref: string;
    status: string;
    date: string;
    slot: string;
    note: string | null;
    created_at: string;
    inspection_started_at: string | null;
    started_at: string | null;
    done_at: string | null;
    odometer: number | null;
    work: string | null;
    cost: number | null;
    warranty_months: number | null;
    warranty_until: string | null;
    work_by: string | null;
    checked_by: string | null;
    quote_number: number | null;
    client_name: string | null;
    client_phone: string | null;
    car: { make?: string | null; model?: string | null; year?: number | string | null; plate?: string | null; vin?: string | null };
    services_ro: string | null;
    services_en: string | null;
  };
  shop: JobDocParty;
  recipient: { company_name?: string; vat_id?: string; address?: string } | null;
  quote: {
    version: number;
    status: string;
    note: string | null;
    inspection_fee: number;
    total_sent: number;
    total_approved: number | null;
    sent_at: string;
    expires_at: string | null;
    decided_at: string | null;
    decided_by: 'client' | 'shop' | null;
    vat_rate: number | null;
    est_hours: number | null;
    terms: string | null;
    items: JobDocItem[];
  } | null;
  intake: {
    odometer: number | null;
    fuel: number | null;
    damages: DamageMark[];
    photos: string[];
    personal_items: string | null;
    notes: string | null;
    keep_parts: boolean | null;
    road_test: boolean | null;
    created_at: string;
    updated_at: string;
    confirmed_at: string | null;
  } | null;
}

export const JOB_DOC_TEXT = {
  ro: {
    'title.quote': 'Deviz',
    'title.final': 'Deviz final',
    'title.intake': 'Fișă de preluare',
    number: 'Nr. {n}',
    issued: 'Emis la {date}',
    annex: 'Anexă la devizul nr. {n}',
    client: 'Client',
    vehicle: 'Vehicul',
    cui: 'CUI {code}',
    regCom: 'Reg. Com. {code}',
    plate: 'Nr. înmatriculare',
    vin: 'Serie șasiu',
    year: 'An fabricație',
    kmIn: 'Km la intrare',
    kmOut: 'Km la ieșire',
    requested: 'Lucrări solicitate',
    clientNote: 'Mențiunea clientului: {note}',
    labor: 'Manoperă',
    parts: 'Piese și materiale',
    lines: 'Lucrări și piese',
    colName: 'Denumire',
    colOperation: 'Operație',
    colHours: 'Ore',
    colRate: 'Tarif / oră',
    colProducer: 'Producător',
    colQty: 'Cant.',
    colUnit: 'Preț unitar',
    colValue: 'Valoare',
    pricesVat: 'Prețurile includ TVA.',
    original: 'Piesă originală',
    alternative: 'Piesă alternativă',
    orAlternative: 'variantă la poziția anterioară',
    refused: 'refuzată de client',
    notChosen: 'neaplicată',
    totalLabor: 'Total manoperă',
    totalParts: 'Total piese și materiale',
    net: 'Total fără TVA',
    vat: 'TVA {rate}%',
    total: 'Total deviz',
    totalAccepted: 'Total acceptat',
    totalFinal: 'Total de plată',
    fee: 'Taxă de constatare',
    term: 'Termen de execuție',
    note: 'Observații',
    terms: 'Mențiunile service-ului',
    consent: 'Acordul clientului',
    accepted: 'Acceptat în aplicație de {name} la {when}.',
    acceptedPartial: 'Acceptat parțial în aplicație de {name} la {when}.',
    acceptedShop: 'Răspunsul clientului a fost înregistrat de service la {when}.',
    waiting: 'Așteaptă răspunsul clientului până la {when}.',
    refusedAll: 'Refuzat de client la {when}.',
    expired: 'Expirat fără răspuns la {when}.',
    opened: 'Deschis la',
    closed: 'Închis la',
    workDone: 'Lucrarea efectuată',
    workBy: 'Lucrări efectuate de',
    checkedBy: 'Lucrări verificate de',
    warranty: 'Garanție',
    warrantyValue: '{months}, până la {until}',
    noWarranty: 'Fără garanție menționată',
    fuel: 'Combustibil',
    fuel0: 'Rezervă',
    fuel1: '1/4',
    fuel2: '1/2',
    fuel3: '3/4',
    fuel4: 'Plin',
    received: 'Preluat la',
    damage: 'Defecte vizibile la preluare',
    noDamage: 'Nu au fost marcate defecte vizibile.',
    front: 'FAȚĂ',
    rear: 'SPATE',
    'kind.scratch': 'Zgârietură',
    'kind.dent': 'Lovitură',
    'kind.crack': 'Fisură',
    'kind.broken': 'Element spart',
    'kind.missing': 'Element lipsă',
    'kind.other': 'Altele',
    personal: 'Obiecte personale',
    observations: 'Observații la preluare',
    keepParts: 'Clientul păstrează piesele înlocuite',
    roadTest: 'Acord pentru proba de drum',
    yes: 'Da',
    no: 'Nu',
    notSaid: 'Nespecificat',
    photos: 'Fotografii la preluare',
    intakeConfirmed: 'Confirmată în aplicație de client la {when}.',
    intakeWaiting: 'Neconfirmată încă de client.',
    footer: 'Emis prin Service-Hub · Programarea {ref} · Nu ține loc de factură fiscală.',
    page: 'Pagina {n} din {total}',
    none: '—',
    hour: '{n} oră',
    hours: '{n} ore',
    hoursMany: '{n} de ore',
    day: '{n} zi',
    days: '{n} zile',
    daysMany: '{n} de zile',
    month: '{n} lună',
    months: '{n} luni',
    monthsMany: '{n} de luni',
    at: '{date}, ora {time}',
  },
  en: {
    'title.quote': 'Quote',
    'title.final': 'Final quote',
    'title.intake': 'Vehicle intake sheet',
    number: 'No. {n}',
    issued: 'Issued on {date}',
    annex: 'Annex to quote no. {n}',
    client: 'Client',
    vehicle: 'Vehicle',
    cui: 'Tax ID {code}',
    regCom: 'Trade reg. {code}',
    plate: 'License plate',
    vin: 'VIN',
    year: 'Year',
    kmIn: 'Odometer in',
    kmOut: 'Odometer out',
    requested: 'Work requested',
    clientNote: "Client's note: {note}",
    labor: 'Labor',
    parts: 'Parts and materials',
    lines: 'Work and parts',
    colName: 'Item',
    colOperation: 'Operation',
    colHours: 'Hours',
    colRate: 'Rate / hour',
    colProducer: 'Brand',
    colQty: 'Qty',
    colUnit: 'Unit price',
    colValue: 'Amount',
    pricesVat: 'Prices include VAT.',
    original: 'Original part',
    alternative: 'Alternative part',
    orAlternative: 'option for the line above',
    refused: 'declined by the client',
    notChosen: 'not chosen',
    totalLabor: 'Labor total',
    totalParts: 'Parts and materials total',
    net: 'Total before VAT',
    vat: 'VAT {rate}%',
    total: 'Quote total',
    totalAccepted: 'Accepted total',
    totalFinal: 'Amount due',
    fee: 'Inspection fee',
    term: 'Estimated time',
    note: 'Notes',
    terms: "Shop's terms",
    consent: "Client's agreement",
    accepted: 'Accepted in the app by {name} on {when}.',
    acceptedPartial: 'Partly accepted in the app by {name} on {when}.',
    acceptedShop: "The client's answer was recorded by the shop on {when}.",
    waiting: "Awaiting the client's answer until {when}.",
    refusedAll: 'Declined by the client on {when}.',
    expired: 'Expired without an answer on {when}.',
    opened: 'Opened on',
    closed: 'Closed on',
    workDone: 'Work done',
    workBy: 'Work done by',
    checkedBy: 'Work checked by',
    warranty: 'Warranty',
    warrantyValue: '{months}, until {until}',
    noWarranty: 'No warranty stated',
    fuel: 'Fuel',
    fuel0: 'Reserve',
    fuel1: '1/4',
    fuel2: '1/2',
    fuel3: '3/4',
    fuel4: 'Full',
    received: 'Received on',
    damage: 'Visible damage at intake',
    noDamage: 'No visible damage was marked.',
    front: 'FRONT',
    rear: 'REAR',
    'kind.scratch': 'Scratch',
    'kind.dent': 'Dent',
    'kind.crack': 'Crack',
    'kind.broken': 'Broken part',
    'kind.missing': 'Missing part',
    'kind.other': 'Other',
    personal: 'Personal items',
    observations: 'Notes at intake',
    keepParts: 'The client keeps the replaced parts',
    roadTest: 'Agrees to a road test',
    yes: 'Yes',
    no: 'No',
    notSaid: 'Not stated',
    photos: 'Photos at intake',
    intakeConfirmed: 'Confirmed in the app by the client on {when}.',
    intakeWaiting: 'Not yet confirmed by the client.',
    footer: 'Issued through Service-Hub · Booking {ref} · Not a tax invoice.',
    page: 'Page {n} of {total}',
    none: '—',
    hour: '{n} hour',
    hours: '{n} hours',
    hoursMany: '{n} hours',
    day: '{n} day',
    days: '{n} days',
    daysMany: '{n} days',
    month: '{n} month',
    months: '{n} months',
    monthsMany: '{n} months',
    at: '{date} at {time}',
  },
} as const;

export type JobDocTextKey = keyof (typeof JOB_DOC_TEXT)['ro'];

export function jobDocText(lang: Lang, key: JobDocTextKey, params: Record<string, string | number> = {}): string {
  const template: string = JOB_DOC_TEXT[lang][key];
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

const LOCALE: Record<Lang, string> = { ro: 'ro-RO', en: 'en-US' };

/** Amounts on a document always show the cents: RO `1.869,00 lei`, EN `1,869.00 RON`. */
export function docMoney(lang: Lang, amount: number): string {
  const n = new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(amount);
  return lang === 'ro' ? `${n} lei` : `${n} RON`;
}

/** A plain amount for a table cell: RO `1.869,00`, EN `1,869.00`. */
export function docAmount(lang: Lang, amount: number): string {
  return new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(amount);
}

/** A quantity or hours: `1,5`, `4`, `0,25` (RO) / `1.5` (EN). */
export function docQuantity(lang: Lang, n: number): string {
  return new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 2, useGrouping: 'always' }).format(n);
}

export function docKm(lang: Lang, km: number): string {
  return `${new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 0, useGrouping: 'always' }).format(km)} km`;
}

/** `28.10.2026` / `10/28/2026`, a calendar day or an instant in Bucharest. */
export function docDay(lang: Lang, value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat(LOCALE[lang], { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Bucharest' }).format(date);
}

/** `28.10.2026, ora 14:32` / `10/28/2026 at 14:32`. */
export function docMoment(lang: Lang, iso: string): string {
  return jobDocText(lang, 'at', { date: docDay(lang, iso), time: formatTime(lang, new Date(iso)) });
}

/** The quote number as printed: `000478`. */
export function docNumber(n: number): string {
  return String(n).padStart(6, '0');
}

function countWord(lang: Lang, base: 'hour' | 'day' | 'month', n: number): string {
  if (lang === 'en') return jobDocText(lang, n === 1 ? base : (`${base}s` as JobDocTextKey), { n });
  if (n === 1) return jobDocText(lang, base, { n });
  const mod = n % 100;
  return jobDocText(lang, (n === 0 || (mod >= 1 && mod <= 19) ? `${base}s` : `${base}sMany`) as JobDocTextKey, { n });
}

/** The estimated time: `2 ore`, `1 zi`, `3 zile`. Whole days from 24 hours on. */
export function docDuration(lang: Lang, hours: number): string {
  return hours >= 24 && hours % 24 === 0 ? countWord(lang, 'day', hours / 24) : countWord(lang, 'hour', hours);
}

export function docMonths(lang: Lang, n: number): string {
  return countWord(lang, 'month', n);
}

export function damageKindText(lang: Lang, kind: DamageKind): string {
  return jobDocText(lang, `kind.${kind}` as JobDocTextKey);
}

export function fuelText(lang: Lang, fuel: number): string {
  return jobDocText(lang, `fuel${Math.max(0, Math.min(4, Math.round(fuel)))}` as JobDocTextKey);
}

/** The car as one line: `Land Rover Defender, 2023`. */
export function docCarName(car: JobDocData['booking']['car']): string {
  const name = [car.make, car.model].map((s) => (s ?? '').toString().trim()).filter(Boolean).join(' ');
  const year = car.year != null && String(car.year).trim() ? String(car.year).trim() : '';
  return [name, year].filter(Boolean).join(', ');
}

/** Lines that count on this document: every line of a quote; the approved ones of a final quote. */
export function docLines(data: JobDocData): JobDocItem[] {
  const items = [...(data.quote?.items ?? [])].sort((a, b) => a.position - b.position);
  if (data.kind === 'final') return items.filter((i) => i.approved === true);
  return items;
}

/** Whether a line counts in the total this document shows. */
export function lineCounts(data: JobDocData, item: JobDocItem): boolean {
  const q = data.quote;
  if (!q) return false;
  const decided = q.status === 'accepted' || q.status === 'partially_accepted';
  if (data.kind === 'final' || decided) return item.approved === true;
  // Before the answer: plain lines and the original of each pair.
  return item.option_group == null || item.variant === 'original';
}

export interface DocTotals {
  labor: number;
  parts: number;
  other: number;
  total: number;
  /** Null when the quote carries no VAT. */
  net: number | null;
  vat: number | null;
}

/** The totals of the lines that count, in bani so the sums stay exact. */
export function docTotals(data: JobDocData): DocTotals {
  let labor = 0;
  let parts = 0;
  let other = 0;
  for (const item of docLines(data)) {
    if (!lineCounts(data, item)) continue;
    const bani = Math.round(item.price * 100);
    if (item.kind === 'labor') labor += bani;
    else if (item.kind === 'part') parts += bani;
    else other += bani;
  }
  const total = labor + parts + other;
  const rate = data.quote?.vat_rate ?? null;
  const net = rate === null ? null : Math.round(total / (1 + rate / 100));
  return {
    labor: labor / 100,
    parts: parts / 100,
    other: other / 100,
    total: total / 100,
    net: net === null ? null : net / 100,
    vat: net === null ? null : (total - net) / 100,
  };
}

/** The sentence under "Acordul clientului": answered, waiting, refused or expired. */
export function consentText(lang: Lang, data: JobDocData): string {
  const q = data.quote;
  if (!q) return '';
  const name = (data.recipient?.company_name ?? data.booking.client_name ?? '').trim() || jobDocText(lang, 'client');
  const decided = q.decided_at ? docMoment(lang, q.decided_at) : '';
  switch (q.status) {
    case 'accepted':
    case 'partially_accepted':
      if (q.decided_by === 'shop') return jobDocText(lang, 'acceptedShop', { when: decided });
      return jobDocText(lang, q.status === 'accepted' ? 'accepted' : 'acceptedPartial', { name, when: decided });
    case 'refused':
      return jobDocText(lang, 'refusedAll', { when: decided });
    case 'expired':
      return jobDocText(lang, 'expired', { when: decided || (q.expires_at ? docMoment(lang, q.expires_at) : '') });
    default:
      return q.expires_at ? jobDocText(lang, 'waiting', { when: docMoment(lang, q.expires_at) }) : '';
  }
}

/** The file name: `deviz-000478.pdf`, `deviz-final-000478.pdf`, `fisa-preluare-P-004213.pdf`. */
export function jobDocFileName(lang: Lang, data: Pick<JobDocData, 'kind' | 'booking'>): string {
  const id = data.booking.quote_number != null ? docNumber(data.booking.quote_number) : data.booking.ref;
  const base =
    data.kind === 'intake'
      ? lang === 'en' ? 'intake-sheet' : 'fisa-preluare'
      : data.kind === 'final'
        ? lang === 'en' ? 'final-quote' : 'deviz-final'
        : lang === 'en' ? 'quote' : 'deviz';
  return `${base}-${id}.pdf`.replace(/[^A-Za-z0-9._-]/g, '');
}
