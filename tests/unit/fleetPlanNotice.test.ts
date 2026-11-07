import { describe, expect, it } from 'vitest';
import { planNotice } from '../../src/lib/fleet';

// P2: the plan is no longer repeated in the header; only what needs action stays, the most urgent first.
const now = new Date('2026-11-06T12:00:00Z');
const base = { read_only: false, status: 'active' as const, trial_ends_at: null, vehicles: 3, vehicle_limit: 10, colleagues: 1, member_limit: null };

describe('the plan warning of a company space (P2)', () => {
  it('nothing to say: no banner (the plan itself is in Abonament și facturare)', () => {
    expect(planNotice(base, 'admin', now)).toBeNull();
  });
  it('expired (read-only) first, for everyone', () => {
    expect(planNotice({ ...base, read_only: true, status: 'past_due' }, 'driver', now)).toMatchObject({ kind: 'expired' });
  });
  it('a payment problem, for those who manage the company', () => {
    expect(planNotice({ ...base, status: 'past_due' }, 'manager', now)).toMatchObject({ kind: 'payment', tone: 'warning' });
    expect(planNotice({ ...base, status: 'past_due' }, 'driver', now)).toBeNull();
  });
  it('vehicles over the limit, then colleagues over the agreed limit', () => {
    expect(planNotice({ ...base, vehicles: 12 }, 'driver', now)).toMatchObject({ kind: 'overVehicles', over: 2, limit: 10 });
    expect(planNotice({ ...base, colleagues: 6, member_limit: 4 }, 'admin', now)).toMatchObject({ kind: 'overMembers', over: 2, limit: 4 });
  });
  it('the last week of the trial (7 days), not before, and not to a driver', () => {
    const trial = { ...base, status: 'trial' as const };
    expect(planNotice({ ...trial, trial_ends_at: '2026-11-12T12:00:00Z' }, 'admin', now)).toMatchObject({ kind: 'trialEnding', days: 6 });
    expect(planNotice({ ...trial, trial_ends_at: '2026-11-20T12:00:00Z' }, 'admin', now)).toBeNull();
    expect(planNotice({ ...trial, trial_ends_at: '2026-11-12T12:00:00Z' }, 'driver', now)).toBeNull();
  });
});
