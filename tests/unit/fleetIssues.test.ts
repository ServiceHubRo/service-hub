import { describe, expect, it } from 'vitest';
import { canReportOn, memberCan, type FleetRole } from '../../src/lib/fleet';

const as = (role: FleetRole, extra: string[] = []) => (c: Parameters<typeof memberCan>[2]) => memberCan(role, extra, c);
const mine = { archived_at: null, driver_id: 'me' };
const other = { archived_at: null, driver_id: 'someone' };

describe('who may report an issue on a vehicle (M3, as fleet_issue_can_report)', () => {
  it('a driver: only the vehicle assigned to them', () => {
    expect(canReportOn(mine, as('driver'), 'me')).toBe(true);
    expect(canReportOn(other, as('driver'), 'me')).toBe(false);
  });
  it('admin and manager: any active vehicle', () => {
    expect(canReportOn(other, as('admin'), 'me')).toBe(true);
    expect(canReportOn(other, as('manager'), 'me')).toBe(true);
  });
  it('the accountant does not report (no issues.report)', () => {
    expect(canReportOn(other, as('accountant'), 'me')).toBe(false);
  });
  it('an extra issues.report with vehicles.viewAll: any vehicle', () => {
    expect(canReportOn(other, as('accountant', ['issues.report']), 'me')).toBe(true);
  });
  it('an archived vehicle takes no report', () => {
    expect(canReportOn({ archived_at: '2026-11-01T00:00:00Z', driver_id: 'me' }, as('admin'), 'me')).toBe(false);
  });
});
