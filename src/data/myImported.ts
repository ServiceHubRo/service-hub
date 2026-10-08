import type { CarSnapshot } from './bookings';
import { call } from './rpc';

/**
 * The jobs shops imported from their old programs for this client (T31b): tied to the account by
 * the confirmed phone, read only, never part of the paid history report.
 */
export interface MyImportedJob {
  id: string;
  /** The day of the job, as the shop's file had it (YYYY-MM-DD). */
  day: string;
  work: string | null;
  odometer: number | null;
  cost: number | null;
  car_snapshot: CarSnapshot;
  shop_id: string;
  shop_name: string;
  shop_city: string;
}

export async function fetchMyImportedJobs(): Promise<MyImportedJob[]> {
  const data = (await call('my_imported_jobs', {} as never)) as unknown as MyImportedJob[];
  return data.map((j) => ({ ...j, cost: j.cost === null ? null : Number(j.cost) }));
}

/** The same, never failing: a help on screens that work without it. */
export function fetchMyImportedJobsQuietly(): Promise<MyImportedJob[]> {
  return fetchMyImportedJobs().catch(() => []);
}
