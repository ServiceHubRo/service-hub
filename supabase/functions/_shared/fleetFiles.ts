// A6 (M4) — the rules of a fleet file upload that do not need the network, shared by the
// fleet-files Edge Function and Vitest. The content checks themselves are the support files' ones
// (_shared/supportFiles.ts): the real type from the bytes, whole files only, active or encrypted
// PDFs refused, every personal metadata of a photo removed (GPS included).
import type { CheckResult, FileKind } from './supportFiles.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where the file goes: a receipt of a vehicle, or a photo of a report (issue) of that vehicle. */
export interface FleetTarget {
  company: string;
  vehicle: string;
  issue: string | null;
}

/** The form fields of an upload, or null when one is missing or is not an id. */
export function parseTarget(fields: { company?: unknown; vehicle?: unknown; issue?: unknown }): FleetTarget | null {
  const id = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);
  const company = id(fields.company);
  const vehicle = id(fields.vehicle);
  const issueGiven = fields.issue !== undefined && fields.issue !== null && fields.issue !== '';
  const issue = issueGiven ? id(fields.issue) : null;
  if (!company || !vehicle || (issueGiven && !issue)) return null;
  return { company, vehicle, issue };
}

/** A report takes photos only; a receipt a photo or a PDF. */
export function kindAllowed(kind: FileKind, target: FleetTarget): boolean {
  return target.issue === null || kind !== 'pdf';
}

/** The code the app translates for a file the checks refused. */
export function rejectionCode(result: Extract<CheckResult, { ok: false }>): string {
  if (result.reason === 'too_large') return 'file_too_large';
  if (result.reason === 'empty') return 'file_corrupt';
  return `file_${result.reason}`;
}

/** Refusals of the database the app translates; anything else is `unknown`. */
export const FLEET_KNOWN = new Set([
  'not_signed_in',
  'not_allowed',
  'account_suspended',
  'file_invalid',
  'too_many_photos',
  'limit_fleet_storage',
  'limit_fleet_uploads',
]);

/** HTTP status of a refusal. */
export function refusalStatus(code: string): number {
  if (code === 'not_signed_in') return 401;
  if (code.startsWith('limit_') || code === 'too_many_photos') return 429;
  if (code === 'file_too_large') return 413;
  if (code.startsWith('file_')) return 422;
  return 403;
}

/** A refusal worth a line in the security log (Platformă → Securitate), with its severity. */
export function securityKind(code: string): { kind: string; severity: 'info' | 'warning' | 'high' } | null {
  if (code === 'file_type' || code === 'file_pdf_active' || code === 'file_pdf_encrypted' || code === 'file_corrupt') {
    return { kind: 'file_rejected', severity: code === 'file_pdf_active' ? 'high' : 'warning' };
  }
  if (code === 'not_allowed') return { kind: 'access_denied', severity: 'warning' };
  if (code === 'limit_fleet_uploads' || code === 'limit_fleet_storage') return { kind: 'limit_fleet_uploads', severity: 'info' };
  return null;
}
