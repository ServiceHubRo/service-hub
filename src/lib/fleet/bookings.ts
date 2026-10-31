import { isActiveStatus } from '../status';
import type { FleetJob } from './types';

/**
 * Programări in the company space (T63d): which bookings a filter keeps and in what order. The
 * quotes waiting for the company come first (the one thing to act on), then what is still going on,
 * soonest first, then what has ended, newest first.
 */
export const JOB_GROUPS = ['all', 'approve', 'active', 'ended'] as const;
export type JobGroup = (typeof JOB_GROUPS)[number];

export interface JobFilter {
  group: JobGroup;
  vehicleId: string | null;
  shopId: string | null;
}

export const NO_JOB_FILTER: JobFilter = { group: 'all', vehicleId: null, shopId: null };

export function jobGroup(job: Pick<FleetJob, 'status'>): Exclude<JobGroup, 'all'> {
  if (job.status === 'quote_sent') return 'approve';
  return isActiveStatus(job.status) ? 'active' : 'ended';
}

export function filterJobs(jobs: readonly FleetJob[], f: JobFilter): FleetJob[] {
  return jobs.filter(
    (j) =>
      (f.group === 'all' || jobGroup(j) === f.group) &&
      (f.vehicleId === null || j.vehicle_id === f.vehicleId) &&
      (f.shopId === null || j.shop_id === f.shopId),
  );
}

const RANK: Record<Exclude<JobGroup, 'all'>, number> = { approve: 0, active: 1, ended: 2 };

export function sortJobs(jobs: readonly FleetJob[]): FleetJob[] {
  return [...jobs].sort((a, b) => {
    const ga = jobGroup(a);
    const gb = jobGroup(b);
    if (ga !== gb) return RANK[ga] - RANK[gb];
    const ka = `${a.date} ${a.slot}`;
    const kb = `${b.date} ${b.slot}`;
    return ga === 'ended' ? kb.localeCompare(ka) : ka.localeCompare(kb);
  });
}

/** The shops the company's bookings went to, by name, for the filter. */
export function jobShops(jobs: readonly FleetJob[]): { id: string; name: string }[] {
  const map = new Map<string, string>();
  for (const j of jobs) map.set(j.shop_id, j.shop_city ? `${j.shop_name}, ${j.shop_city}` : j.shop_name);
  return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ro'));
}
