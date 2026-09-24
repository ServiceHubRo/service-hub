/**
 * Validators and normalizers (ARCHITECTURE §14). The same rules live in SQL
 * (supabase/migrations/*_foundation.sql); both are tested against tests/fixtures/validator-vectors.json.
 * Validators ignore spaces and letter case; normalizers return the form the database stores.
 */

const compact = (value: string) => value.replace(/\s/g, '').toUpperCase();

/** `ro 14872301` → `RO14872301`. Empty → null. */
export function normalizeCode(value: string): string | null {
  const v = compact(value);
  return v === '' ? null : v;
}

const CUI_KEY = '753217532';

/** CUI: optional RO prefix, 2–10 digits, control digit with key 753217532. */
export function isValidCui(value: string): boolean {
  let v = compact(value);
  if (v.startsWith('RO')) v = v.slice(2);
  if (!/^\d{2,10}$/.test(v)) return false;
  const body = v.slice(0, -1).padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(body[i]) * Number(CUI_KEY[i]);
  const control = ((sum * 10) % 11) % 10;
  return control === Number(v.slice(-1));
}

/** Trade Register: old `J08/1234/2015` or new (2024+) `J2024000123010`. */
export function isValidRegCom(value: string): boolean {
  const v = compact(value);
  return /^[JFC]\d{1,2}\/\d{1,7}\/\d{4}$/.test(v) || /^[JFC]\d{13}$/.test(v);
}

/** Romanian IBAN: RO + 2 digits + 20 alphanumerics, mod-97 = 1. */
export function isValidIban(value: string): boolean {
  const v = compact(value);
  if (!/^RO\d{2}[A-Z0-9]{20}$/.test(v)) return false;
  const rearranged = v.slice(4) + v.slice(0, 4);
  let rest = 0;
  for (const ch of rearranged) {
    rest = /\d/.test(ch) ? (rest * 10 + Number(ch)) % 97 : (rest * 100 + ch.charCodeAt(0) - 55) % 97;
  }
  return rest === 1;
}

/** Postal code: exactly 6 digits. */
export function isValidPostalCode(value: string): boolean {
  return /^\d{6}$/.test(value.replace(/\s/g, ''));
}

/** VIN: 17 characters, A–Z and 0–9 without I, O, Q. */
export function isValidVin(value: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(compact(value));
}

/** Plate as matched across bookings: upper-case, no spaces or dashes (`bv-12 abc` → `BV12ABC`). */
export function normalizePlate(value: string): string | null {
  const v = value.replace(/[\s-]/g, '').toUpperCase();
  return v === '' ? null : v;
}

/**
 * Romanian phone number → `+40723375248`, or null when it is not one.
 * Accepts `0723 375 248`, `+40 723…`, `0040 723…`, dashes, dots and brackets.
 * Mobile numbers start with 7, landlines with 2 or 3.
 */
export function normalizePhone(value: string): string | null {
  let digits = value.replace(/[\s\-.()]/g, '');
  if (digits.startsWith('+40')) digits = digits.slice(3);
  else if (digits.startsWith('0040')) digits = digits.slice(4);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  else return null;
  return /^[237]\d{8}$/.test(digits) ? `+40${digits}` : null;
}

/** `+40723375248` → `0723 375 248`. Anything else is returned as it is. */
export function formatPhone(value: string): string {
  const normalized = normalizePhone(value);
  if (!normalized) return value;
  const national = `0${normalized.slice(3)}`;
  return `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`;
}

/** Odometer rules (ARCHITECTURE §7), the same as `complete_job`. */
export const ODOMETER_MIN = 100;
export const ODOMETER_MAX = 2_000_000;
/** More than this above the last reading needs an explicit confirmation. */
export const ODOMETER_JUMP = 50_000;

/**
 * Odometer as typed → whole km: `105400`, `105.400`, `105 400` and `105,400` are all 105 400
 * (kilometres have no decimals, so dots, commas and spaces can only group thousands). Null when
 * it is empty or holds anything else.
 */
export function parseOdometer(text: string): number | null {
  const compacted = text.replace(/[\s.,]/g, '');
  if (!/^\d{1,9}$/.test(compacted)) return null;
  return Number(compacted);
}

export type OdometerCheck =
  | { ok: true; km: number; /** km above the last reading when that needs a confirmation. */ jump: number | null }
  | { ok: false; error: 'odometer_required' | 'odometer_invalid' | 'odometer_lower'; previous?: number };

/** Checked in the database's order: required, 100–2 000 000, not lower than the last reading, jump. */
export function checkOdometer(text: string, last: number | null): OdometerCheck {
  if (text.trim() === '') return { ok: false, error: 'odometer_required' };
  const km = parseOdometer(text);
  if (km === null || km < ODOMETER_MIN || km > ODOMETER_MAX) return { ok: false, error: 'odometer_invalid' };
  if (last !== null && km < last) return { ok: false, error: 'odometer_lower', previous: last };
  return { ok: true, km, jump: last !== null && km - last > ODOMETER_JUMP ? km - last : null };
}
