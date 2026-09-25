import { formatMonthYear } from '../i18n/format';
import type { Lang } from '../i18n/translate';
import { jobsOf, otherVehicles, type VehicleFields } from './history';
import type { BookingStatus } from './status';

/**
 * The paid history report (FR §3.6b, P16e): pure logic for the preview and Rapoartele mele.
 */

/**
 * From which row the preview hides its lines until the report is paid (P16e: "the last two rows
 * blurred"): the last two of three or more, the last of two, none of one — so the preview always
 * shows at least one job in full.
 */
export function hiddenFrom(jobs: number): number {
  return Math.max(1, jobs - 2);
}

/** RO `sep 2025 – aug 2026`; one month when both ends are in it. */
export function formatPeriod(lang: Lang, from: string | null, to: string | null): string {
  if (!from || !to) return from || to ? formatMonthYear(lang, (from ?? to)!) : '';
  const a = formatMonthYear(lang, from);
  const b = formatMonthYear(lang, to);
  return a === b ? a : `${a} – ${b}`;
}

interface Job {
  id: string;
  status: BookingStatus;
  car_snapshot: VehicleFields;
  date: string;
  slot: string;
  done_at: string | null;
  cost: number | null;
}

export type ReportCandidate<C> =
  | { kind: 'car'; car: C; jobs: number }
  | { kind: 'booking'; vehicle: VehicleFields; bookingId: string; jobs: number };

/**
 * The cars a report can be bought for (only cars with finished jobs, FR §3.6b): the garage cars
 * first, then cars no longer in the garage (by their newest job).
 */
export function reportCandidates<C extends VehicleFields & { id: string }, B extends Job>(
  cars: readonly C[],
  bookings: readonly B[],
): ReportCandidate<C>[] {
  const out: ReportCandidate<C>[] = [];
  for (const car of cars) {
    const jobs = jobsOf(bookings, car).length;
    if (jobs > 0) out.push({ kind: 'car', car, jobs });
  }
  for (const other of otherVehicles(bookings, cars)) {
    out.push({ kind: 'booking', vehicle: other.latest.car_snapshot, bookingId: other.latest.id, jobs: other.jobs });
  }
  return out;
}

/** Report codes as typed by a buyer: `sh 2026 000147` → `SH-2026-000147`; null when it cannot be one. */
export function normalizeReportCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = /^SH(\d{4})(\d{6})$/.exec(s);
  return m ? `SH-${m[1]}-${m[2]}` : null;
}

/** Saves a downloaded file under its name (the browser's download, or the PDF viewer on iOS). */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** `raport-SH-2026-000147.pdf` / `report-SH-2026-000147.pdf` (same as the server's name). */
export function reportFileName(lang: Lang, code: string): string {
  return `${lang === 'en' ? 'report' : 'raport'}-${code}.pdf`;
}
