import { csvAmount, csvFormat, toCsv } from '../history';
import type { CostEntry } from './costs';

/**
 * The costs of the chosen filters as CSV, in the interface language (the Istoric format: RO `;` and
 * decimal comma, EN `,` and decimal point, UTF-8 with BOM, formula-like cells defused). The rows are
 * the ones already on screen, i.e. already limited to what the member may see.
 */
export interface CostCsvLabels {
  header: readonly string[];
  vehicle: (vehicleId: string) => string;
  category: (entry: CostEntry) => string;
  source: (entry: CostEntry) => string;
}

export function costsCsv(entries: readonly CostEntry[], lang: 'ro' | 'en', labels: CostCsvLabels): string {
  const { separator, decimal } = csvFormat(lang);
  const rows = entries.map((e) => [
    e.day,
    labels.vehicle(e.vehicle_id),
    labels.category(e),
    labels.source(e),
    e.vendor ?? '',
    e.odometer === null ? '' : String(e.odometer),
    csvAmount(e.amount, decimal),
  ]);
  return toCsv([labels.header, ...rows], separator);
}
