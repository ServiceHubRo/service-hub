import { describe, expect, it } from 'vitest';
import { latestKm, odometerLog, type FleetJob, type FleetReading } from '../../src/lib/fleet';

const reading = (id: string, day: string, km: number): FleetReading => ({
  id,
  vehicle_id: 'v1',
  day,
  km,
  source: 'manual',
  ref_id: null,
  corrected_from: null,
  correction_reason: null,
  created_by_name: null,
  created_at: `${day}T08:00:00Z`,
  updated_at: null,
});
const job = (id: string, day: string, km: number) => ({ id, vehicle_id: 'v1', status: 'done', odometer: km, done_at: `${day}T10:00:00Z`, date: day }) as unknown as FleetJob;

describe('the odometer log (M2)', () => {
  it('merges readings and finished jobs, newest first', () => {
    const log = odometerLog('v1', [reading('r1', '2026-10-01', 100000), reading('r2', '2026-10-20', 101000)], [job('j1', '2026-10-10', 100400)], []);
    expect(log.map((e) => e.key)).toEqual(['r:r2', 'j:j1', 'r:r1']);
    expect(latestKm(log)).toBe(101000);
  });

  it('more than 2,000 km a day is an anomaly to check, not an error', () => {
    const log = odometerLog('v1', [reading('r1', '2026-10-01', 100000), reading('r2', '2026-10-02', 102500), reading('r3', '2026-10-04', 106400)], [], []);
    expect(log.find((e) => e.key === 'r:r2')!.anomaly).toBe(true);
    expect(log.find((e) => e.key === 'r:r3')!.anomaly).toBe(false);
  });

  it('the same day is never an anomaly', () => {
    const log = odometerLog('v1', [reading('r1', '2026-10-01', 100000), reading('r2', '2026-10-01', 109000)], [], []);
    expect(log.some((e) => e.anomaly)).toBe(false);
  });

  it('an ignored job is listed but neither counted nor compared', () => {
    const log = odometerLog('v1', [reading('r1', '2026-10-01', 100000), reading('r2', '2026-10-20', 101000)], [job('j1', '2026-10-10', 900000)], [
      { booking_id: 'j1', reason: 'greșit', at: '2026-10-21T00:00:00Z' },
    ]);
    expect(log.find((e) => e.key === 'j:j1')!.ignored).toBe(true);
    expect(log.some((e) => e.anomaly)).toBe(false);
    expect(latestKm(log)).toBe(101000);
  });

  it('another vehicle is never mixed in', () => {
    expect(odometerLog('v2', [reading('r1', '2026-10-01', 100000)], [], [])).toEqual([]);
    expect(latestKm([])).toBeNull();
  });
});
