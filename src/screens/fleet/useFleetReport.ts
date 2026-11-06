import { useCallback } from 'react';
import type { FleetReport, ReportFilters } from '../../lib/fleet';
import { useLoad } from '../../lib/useLoad';
import { useFleet } from './fleetContext';

export interface ReportRequest {
  range: { from: string | null; to: string };
  previous: { from: string | null; to: string } | null;
  filters: ReportFilters;
}

/**
 * A report from the database (T65) for Rapoarte and the financial part of Panou. Read again when the
 * question changes or the company's data does (a finished job, a new vehicle); the previous answer
 * stays on screen meanwhile, so nothing flashes. `null` request = not asked (the plan or the role).
 */
export function useFleetReport(request: ReportRequest | null) {
  const { loadReport, data } = useFleet();
  const key = request ? JSON.stringify(request) : '';
  const load = useCallback(async (): Promise<FleetReport | null> => {
    if (!key) return null;
    const r = JSON.parse(key) as ReportRequest;
    return loadReport(r.range, r.previous, r.filters);
    // `data`: the company changed, the figures are read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadReport, data]);
  return useLoad(load);
}
