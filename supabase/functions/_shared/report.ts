// The paid history report (T15, FR §3.6b, P16e): what the PDF says and how it formats dates,
// amounts and kilometers, in the report's language. No Deno and no npm here, so the unit tests
// load it; the drawing is in reportPdf.ts.
import { formatMoney, type Lang } from './format.ts';

export type { Lang };

/** One finished job, as report_jobs() stores it in history_reports.jobs (newest first). */
export interface ReportJob {
  id?: string;
  ref?: string | null;
  date: string; // YYYY-MM-DD, the day it was finished (Bucharest)
  shop_name: string | null;
  shop_city: string | null;
  service_id?: string | null;
  service_ro: string | null;
  service_en: string | null;
  items: string[];
  work: string | null;
  odometer: number | null;
  cost: number | null;
}

export interface ReportCar {
  make?: string | null;
  model?: string | null;
  year?: number | string | null;
  plate?: string | null;
  vin?: string | null;
}

/** Everything the PDF prints. */
export interface ReportData {
  code: string;
  lang: Lang;
  /** When the report was generated (ISO). */
  generatedAt: string;
  car: ReportCar;
  jobs: ReportJob[];
  total: number;
  periodFrom: string | null;
  periodTo: string | null;
  latestOdometer: number | null;
  odometerOutOfOrder: boolean;
  /** Where a buyer checks the code, without the scheme: `service-hub.ro/verifica`. */
  verifyAt: string;
}

export const REPORT_TEXT = {
  ro: {
    title: 'Raport istoric service',
    generated: 'Generat la {date}, ora {time}',
    subtitle: 'Istoricul lucrărilor efectuate prin Service-Hub',
    car: 'Autoturism',
    plate: 'Număr de înmatriculare',
    year: 'An fabricație',
    vin: 'Serie șasiu',
    code: 'Cod raport',
    codeHint: 'Verificabil public, fără cont',
    colDate: 'Data',
    colShop: 'Service',
    colWork: 'Lucrare',
    colKm: 'Km',
    colCost: 'Cost',
    total: 'Total',
    jobs: 'Lucrări',
    period: 'Perioadă acoperită',
    lastKm: 'Km la ultima lucrare',
    kmNote:
      'Citirile de kilometraj nu sunt în ordine crescătoare. Le-am păstrat exact cum au fost introduse de service-uri, fără să le reordonăm sau să le corectăm.',
    disclaimerLead: 'Important.',
    disclaimer:
      'Acest raport conține exclusiv lucrările efectuate prin platforma Service-Hub și înregistrate de service-urile partenere. Nu reprezintă istoricul complet de service al vehiculului: lucrările efectuate în alte ateliere, în regie proprie sau înainte de înregistrarea vehiculului în aplicație nu apar aici. Datele sunt cele raportate de service-urile care au efectuat lucrările. Service-Hub este intermediar și nu răspunde pentru calitatea lucrărilor. Raport generat automat la {date} · Service-Hub · {host}',
    page: 'Pagina {n} din {total}',
    continued: 'continuare',
    footerNote:
      'Conține doar lucrările efectuate prin Service-Hub, așa cum le-au înregistrat service-urile. Nu este istoricul complet al vehiculului.',
    footerVerify: 'Verifică la {address} cu codul {code}',
    unknownShop: 'Service',
    none: '—',
  },
  en: {
    title: 'Service history report',
    generated: 'Generated on {date} at {time}',
    subtitle: 'Work done through Service-Hub',
    car: 'Car',
    plate: 'License plate',
    year: 'Year',
    vin: 'VIN',
    code: 'Report code',
    codeHint: 'Publicly verifiable, no account needed',
    colDate: 'Date',
    colShop: 'Shop',
    colWork: 'Work',
    colKm: 'Km',
    colCost: 'Cost',
    total: 'Total',
    jobs: 'Jobs',
    period: 'Period covered',
    lastKm: 'Km at last job',
    kmNote:
      'The odometer readings do not increase with the dates. They are shown exactly as the shops entered them, not re-sorted or corrected.',
    disclaimerLead: 'Important.',
    disclaimer:
      'This report covers only work carried out through the Service-Hub platform and recorded by its partner shops. It is not the complete service history of the vehicle: work done at other shops, by the owner, or before the vehicle was added to the app does not appear here. The data is as reported by the shops that did the work. Service-Hub is an intermediary and is not responsible for the quality of the work. Report generated automatically on {date} · Service-Hub · {host}',
    page: 'Page {n} of {total}',
    continued: 'continued',
    footerNote: 'Covers only work done through Service-Hub, as recorded by the shops. Not the complete service history of the vehicle.',
    footerVerify: 'Verify at {address} with code {code}',
    unknownShop: 'Shop',
    none: '—',
  },
} as const;

export type ReportTextKey = keyof (typeof REPORT_TEXT)['ro'];

export function reportText(lang: Lang, key: ReportTextKey, params: Record<string, string | number> = {}): string {
  return REPORT_TEXT[lang][key].replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

const TIME_ZONE = 'Europe/Bucharest';
const RO_MONTHS = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ymdParts(ymd: string): [string, string, string] {
  const [y = '', m = '', d = ''] = ymd.slice(0, 10).split('-');
  return [y, m, d];
}

/** A calendar day: RO `12.08.2026`, EN `08/12/2026`. */
export function reportDay(lang: Lang, ymd: string): string {
  const [y, m, d] = ymdParts(ymd);
  return lang === 'ro' ? `${d}.${m}.${y}` : `${m}/${d}/${y}`;
}

/** The day and the time of an instant in Bucharest: { date: reportDay, time: `12:40` }. */
export function reportMoment(lang: Lang, iso: string): { date: string; time: string } {
  const out: Record<string, string> = {};
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  for (const p of parts) out[p.type] = p.value;
  return { date: reportDay(lang, `${out.year}-${out.month}-${out.day}`), time: `${out.hour}:${out.minute}` };
}

/** RO `aug 2026`, EN `Aug 2026`. */
export function reportMonth(lang: Lang, ymd: string): string {
  const [y, m] = ymdParts(ymd);
  const months = lang === 'ro' ? RO_MONTHS : EN_MONTHS;
  return `${months[Number(m) - 1] ?? m} ${y}`;
}

/** RO `sep 2025 – aug 2026`; one month when both ends are in the same one. */
export function reportPeriod(lang: Lang, from: string | null, to: string | null): string {
  if (!from && !to) return REPORT_TEXT[lang].none;
  const a = reportMonth(lang, (from ?? to)!);
  const b = reportMonth(lang, (to ?? from)!);
  return a === b ? a : `${a} – ${b}`;
}

/** A reading without the unit (the column says KM): RO `105.400`, EN `105,400`. */
export function reportKm(lang: Lang, km: number): string {
  return new Intl.NumberFormat(lang === 'ro' ? 'ro-RO' : 'en-US', { maximumFractionDigits: 0, useGrouping: 'always' }).format(km);
}

export function reportMoney(lang: Lang, amount: number): string {
  return formatMoney(lang, amount);
}

/** `Volkswagen Golf 7`, or the generic word when the car has no name. */
export function reportCarName(lang: Lang, car: ReportCar): string {
  return [car.make, car.model].map((s) => (s ?? '').trim()).filter(Boolean).join(' ') || REPORT_TEXT[lang].car;
}

/** The service's name in the report's language. */
export function jobService(lang: Lang, job: ReportJob): string {
  return (lang === 'en' ? job.service_en || job.service_ro : job.service_ro || job.service_en) || job.service_id || '';
}

/** `service-hub.ro/verifica` from the app's address. */
export function verifyAddress(appUrl: string): string {
  try {
    return `${new URL(appUrl).host}/verifica`;
  } catch {
    return 'service-hub.ro/verifica';
  }
}

/** The file name the browser saves: `raport-SH-2026-000147.pdf` / `report-SH-2026-000147.pdf`. */
export function reportFileName(lang: Lang, code: string): string {
  return `${lang === 'en' ? 'report' : 'raport'}-${code}.pdf`;
}

/** Where the PDF lives in the private `reports` bucket. */
export function reportPath(clientId: string | null, reportId: string, code: string): string {
  return `${clientId ?? 'fara-cont'}/${reportId}/${code}.pdf`;
}

/** The report's data from its history_reports row. */
export function reportDataFromRow(row: Record<string, unknown>, verifyAt: string): ReportData {
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const jobs = (Array.isArray(row.jobs) ? row.jobs : []) as Record<string, unknown>[];
  return {
    code: String(row.code ?? ''),
    lang: row.lang === 'en' ? 'en' : 'ro',
    generatedAt: typeof row.generated_at === 'string' ? row.generated_at : new Date().toISOString(),
    car: (row.car_snapshot ?? {}) as ReportCar,
    jobs: jobs.map((j) => ({
      id: typeof j.id === 'string' ? j.id : undefined,
      ref: typeof j.ref === 'string' ? j.ref : null,
      date: String(j.date ?? ''),
      shop_name: typeof j.shop_name === 'string' ? j.shop_name : null,
      shop_city: typeof j.shop_city === 'string' ? j.shop_city : null,
      service_id: typeof j.service_id === 'string' ? j.service_id : null,
      service_ro: typeof j.service_ro === 'string' ? j.service_ro : null,
      service_en: typeof j.service_en === 'string' ? j.service_en : null,
      items: Array.isArray(j.items) ? j.items.filter((i): i is string => typeof i === 'string') : [],
      work: typeof j.work === 'string' ? j.work : null,
      odometer: num(j.odometer),
      cost: num(j.cost),
    })),
    total: num(row.total_amount) ?? 0,
    periodFrom: typeof row.period_from === 'string' ? row.period_from : null,
    periodTo: typeof row.period_to === 'string' ? row.period_to : null,
    latestOdometer: num(row.latest_odometer),
    odometerOutOfOrder: row.odometer_out_of_order === true,
    verifyAt,
  };
}
