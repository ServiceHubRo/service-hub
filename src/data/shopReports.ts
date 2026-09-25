import { call } from './rpc';
import type { ReportData } from '../lib/shopReports';

/**
 * Rapoarte (FR §4.9, P22; T17): `shop_reports()` answers the raw rows of the caller's shop in one
 * read — to its owner only (the takings are in it); staff get null. The sums are in
 * `src/lib/shopReports.ts`.
 */

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Amounts and counts arrive as JSON numbers or numeric text; normalized once here. */
function normalize(data: ReportData): ReportData {
  return {
    ...data,
    shop: { ...data.shop, daily_capacity: toNumber(data.shop.daily_capacity) },
    jobs: data.jobs.map((j) => ({ ...j, cost: j.cost === null || j.cost === undefined ? null : toNumber(j.cost) })),
    days: data.days.map((d) => ({ ...d, cars: toNumber(d.cars) })),
  };
}

/** The report data, or null when the caller works for the shop but does not own it. */
export async function fetchShopReports(): Promise<ReportData | null> {
  const data = (await call('shop_reports', {} as never)) as unknown as ReportData | null;
  return data ? normalize(data) : null;
}
