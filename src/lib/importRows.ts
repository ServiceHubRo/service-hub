import { isValidVin, normalizeCode } from './validators';

/**
 * From the rows of a file to what `shop_import_add` takes (T31a): which column holds what
 * (guessed from the header, changed by the shop), each value cleaned the way people write it —
 * `0722 111 222`, `14.03.2024`, `1.250,50 lei`, `105.400 km` — and checked with the same rules
 * as the database. A value that cannot be read is left out (the row still comes in); a row whose
 * job date cannot be read, or that holds nothing to keep, is skipped and listed.
 */

export const IMPORT_FIELDS = [
  'name',
  'phone',
  'email',
  'make',
  'model',
  'year',
  'plate',
  'vin',
  'day',
  'work',
  'odometer',
  'cost',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Field → column index (or absent). */
export type ImportMapping = Partial<Record<ImportField, number>>;

/** What one row sends; `row` is its line in the file (1 = the header). */
export interface ImportRow {
  row: number;
  name?: string;
  phone?: string;
  email?: string;
  make?: string;
  model?: string;
  year?: number;
  plate?: string;
  vin?: string;
  day?: string;
  work?: string;
  odometer?: number;
  cost?: number;
}

export type ImportProblem = 'day' | 'empty' | 'car';

export interface ImportCheck {
  rows: ImportRow[];
  /** Rows skipped, with why. */
  skipped: { row: number; problem: ImportProblem }[];
  /** Values that could not be read and were left out (a wrong phone, an amount as text). */
  ignored: number;
  clients: number;
  cars: number;
  jobs: number;
}

/** Lower case, without diacritics or punctuation: `Nr. înmatriculare` → `nr inmatriculare`. */
function simplify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Header words per field, Romanian and English; the first exact or contained match wins. */
const HEADER_WORDS: Record<ImportField, readonly string[]> = {
  name: ['nume client', 'nume', 'client', 'name', 'customer', 'proprietar', 'nume prenume', 'beneficiar'],
  phone: ['telefon', 'tel', 'mobil', 'phone', 'nr telefon', 'numar telefon', 'mobile'],
  email: ['email', 'e mail', 'mail'],
  make: ['marca', 'make', 'brand', 'masina', 'auto', 'vehicul', 'autovehicul', 'car', 'vehicle'],
  model: ['model'],
  year: ['an fabricatie', 'an', 'year', 'anul'],
  plate: [
    'nr inmatriculare',
    'numar inmatriculare',
    'inmatriculare',
    'nr auto',
    'numar auto',
    'plate',
    'license plate',
    'registration',
    'nr inm',
    'nr',
    'numar',
  ],
  vin: ['vin', 'serie sasiu', 'serie caroserie', 'sasiu', 'serie'],
  day: ['data lucrarii', 'data', 'date', 'zi', 'data intrare', 'data iesire'],
  work: ['lucrare', 'lucrari', 'descriere', 'operatiuni', 'servicii', 'work', 'description', 'service', 'manopera', 'observatii'],
  odometer: ['km', 'kilometraj', 'kilometri', 'odometer', 'mileage', 'rulaj'],
  cost: ['suma', 'total', 'pret', 'valoare', 'cost', 'amount', 'price', 'total lei', 'de plata'],
};

/** Which column holds what, from the header row. Each column goes to one field at most. */
export function guessMapping(header: readonly string[]): ImportMapping {
  const cols = header.map(simplify);
  const mapping: ImportMapping = {};
  const used = new Set<number>();
  // Exact names first (so "an" is not taken by "an fabricatie"'s column), then words inside.
  for (const pass of ['exact', 'contains'] as const) {
    for (const field of IMPORT_FIELDS) {
      if (mapping[field] !== undefined) continue;
      for (const word of HEADER_WORDS[field]) {
        const i = cols.findIndex((c, idx) => {
          if (used.has(idx) || c === '') return false;
          if (pass === 'exact') return c === word;
          // Short words only as whole words ("an" not inside "pantofi").
          return word.length <= 3 ? c.split(' ').includes(word) : c.includes(word);
        });
        if (i >= 0) {
          mapping[field] = i;
          used.add(i);
          break;
        }
      }
    }
  }
  return mapping;
}

/** `0722 111 222`, `+40 722…`, `0040…`, `722111222`, `40722…` → `+40722111222`; a foreign `+…` kept. */
export function importPhone(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const plus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!plus && digits.startsWith('00')) digits = digits.slice(2);
  else if (!plus && digits.startsWith('0')) digits = `40${digits.slice(1)}`;
  else if (!plus && /^[237]\d{8}$/.test(digits)) digits = `40${digits}`;
  if (digits.startsWith('40')) return /^40[237]\d{8}$/.test(digits) ? `+${digits}` : null;
  return (plus || raw.startsWith('00')) && /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A day as people and programs write it: `2024-03-14`, `14.03.2024`, `14/03/2024`, `14-03-24`, an
 * Excel day number (`45365`), with a time after it or not. Day first, unless the second number
 * cannot be a month (`03/25/2024`). Null when it is not a real day.
 */
export function importDay(value: string): string | null {
  const s = value.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T].*)?$/.exec(s))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})(?:[ T,].*)?$/.exec(s))) {
    let a = Number(match[1]);
    let b = Number(match[2]);
    if (b > 12 && a <= 12) [a, b] = [b, a];
    d = a;
    m = b;
    y = Number(match[3]);
    if (match[3]!.length === 2) y += y <= new Date().getFullYear() % 100 ? 2000 : 1900;
  } else if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Excel counts days from 30 Dec 1899.
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86_400_000);
    [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** `1.250,50 lei`, `1,250.50`, `350`, `350,5`, `RON 1 250` → 1250.5; null when it is not an amount. */
export function importAmount(value: string): number | null {
  let s = value.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s) || s.includes('-')) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    s = s
      .split(decimal === '.' ? ',' : '.')
      .join('')
      .replace(',', '.');
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) && s.split(',').length === 2 ? s.replace(',', '.') : s.split(',').join('');
  } else if (lastDot >= 0 && (/\.\d{3}$/.test(s) || s.split('.').length > 2)) {
    s = s.split('.').join('');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return n < 10_000_000 ? n : null;
}

/** `105.400 km`, `105 400`, `105,400` → 105400. */
export function importOdometer(value: string): number | null {
  const s = value.replace(/km/i, '').replace(/[\s.,]/g, '');
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = Number(s);
  return n <= 2_000_000 ? n : null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Rows of the file (header first) with the mapping → what to send, what is skipped, and counts. */
export function checkRows(table: readonly (readonly string[])[], mapping: ImportMapping, today: string): ImportCheck {
  const out: ImportCheck = { rows: [], skipped: [], ignored: 0, clients: 0, cars: 0, jobs: 0 };
  const clients = new Set<string>();
  const cars = new Set<string>();
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (f: ImportField) => {
      const col = mapping[f];
      return col === undefined ? '' : (cells[col] ?? '').replace(/\s+/g, ' ').trim();
    };
    if (IMPORT_FIELDS.every((f) => get(f) === '')) return;
    const r: ImportRow = { row: line };
    // Values left out of this row; counted only when the row itself comes in.
    let ignored = 0;
    const name = get('name');
    if (name) r.name = name.slice(0, 120);

    const phoneRaw = get('phone');
    if (phoneRaw) {
      const phone = importPhone(phoneRaw);
      if (phone) r.phone = phone;
      else ignored++;
    }
    const emailRaw = get('email').toLowerCase();
    if (emailRaw) {
      if (EMAIL_RE.test(emailRaw) && emailRaw.length <= 254) r.email = emailRaw;
      else ignored++;
    }

    // "Dacia Logan" in one column: the first word is the make.
    let make = get('make');
    let model = get('model');
    if (make && mapping.model === undefined && make.includes(' ')) {
      model = make.slice(make.indexOf(' ') + 1).trim();
      make = make.slice(0, make.indexOf(' '));
    }
    const plate = get('plate').toUpperCase();
    if (make.length > 60 || model.length > 60 || plate.length > 20) {
      out.skipped.push({ row: line, problem: 'car' });
      return;
    }
    if (make) r.make = make;
    else if (model) r.make = model; // a model alone stands as the car's name
    if (make && model) r.model = model;
    if (plate) r.plate = plate;
    const yearRaw = get('year');
    if (yearRaw) {
      const year = /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : NaN;
      if (year >= 1900 && year <= 2100) r.year = year;
      else ignored++;
    }
    const vinRaw = normalizeCode(get('vin'));
    if (vinRaw) {
      if (isValidVin(vinRaw)) r.vin = vinRaw;
      else ignored++;
    }

    const work = get('work');
    if (work) r.work = work.slice(0, 2000);
    const odoRaw = get('odometer');
    if (odoRaw) {
      const odo = importOdometer(odoRaw);
      if (odo !== null) r.odometer = odo;
      else ignored++;
    }
    const costRaw = get('cost');
    if (costRaw) {
      const cost = importAmount(costRaw);
      if (cost !== null) r.cost = cost;
      else ignored++;
    }
    const dayRaw = get('day');
    const hasJob = r.work !== undefined || r.cost !== undefined || r.odometer !== undefined;
    if (dayRaw) {
      const day = importDay(dayRaw);
      if (!day || day > today || day < '1990-01-01') {
        out.skipped.push({ row: line, problem: 'day' });
        return;
      }
      if (hasJob) r.day = day;
    } else if (hasJob) {
      // A job needs its day: keep the client and the car, leave the job out.
      delete r.work;
      delete r.cost;
      delete r.odometer;
      ignored++;
    }

    if (!r.name && !r.make && !r.plate) {
      out.skipped.push({ row: line, problem: 'empty' });
      return;
    }
    out.rows.push(r);
    out.ignored += ignored;
    if (r.name || r.phone) clients.add(r.phone ?? `n:${r.name!.toLowerCase()}`);
    if (r.make || r.plate)
      cars.add(
        r.plate ? `p:${r.plate.replace(/[^A-Z0-9]/g, '')}` : `c:${r.phone ?? r.name}|${r.make}|${r.model ?? ''}`.toLowerCase(),
      );
    if (r.day) out.jobs++;
  });
  out.clients = clients.size;
  out.cars = cars.size;
  return out;
}

/** Chunks of at most `size` rows (the database takes 1 000 at a time). */
export function chunks<T>(items: readonly T[], size = 1000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
