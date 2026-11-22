import { describe, expect, it } from 'vitest';
import { memberCan, startSteps, type FleetCapability, type FleetOverview, type FleetRole } from '../../src/lib/fleet';

// „Primii pași” of the fleet space (Eduard, 21 Nov 2026): which steps a member sees and which are done.

type Data = Pick<FleetOverview, 'vehicles' | 'members' | 'me' | 'company'>;

const data = (over: { vehicles?: number; others?: number; budget?: number | null; role?: FleetRole } = {}): Data =>
  ({
    company: { id: 'c1', name: 'Flota', vat_id: null, plan_key: 'business', manager_approval_limit: null, budget: { monthly: over.budget ?? null } },
    me: { member_id: 'me', role: over.role ?? 'admin' },
    vehicles: Array.from({ length: over.vehicles ?? 0 }, (_, i) => ({ id: `v${i}` })),
    members: [{ id: 'me' }, ...Array.from({ length: over.others ?? 0 }, (_, i) => ({ id: `m${i}` }))],
  }) as unknown as Data;

const canAs = (role: FleetRole) => (c: FleetCapability) => memberCan(role, undefined, c);
const business = { features: ['reports', 'budget', 'dashboard_finance'] };
const starter = { features: [] };

describe('startSteps', () => {
  it('an admin of a new fleet has the three steps, none done', () => {
    const steps = startSteps(data(), canAs('admin'), business);
    expect(steps.map((s) => s.key)).toEqual(['vehicle', 'members', 'budget']);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it('each step is ticked by the data itself', () => {
    const steps = startSteps(data({ vehicles: 2, others: 1, budget: 5000 }), canAs('admin'), business);
    expect(steps.map((s) => s.done)).toEqual([true, true, true]);
    // Only the member themself is not a colleague invited.
    expect(startSteps(data({ vehicles: 1 }), canAs('admin'), business).map((s) => s.done)).toEqual([true, false, false]);
  });

  it('the steps open the page where each is done', () => {
    const links = startSteps(data(), canAs('admin'), business).map((s) => s.link);
    expect(links).toEqual([{ section: 'vehicule', filter: 'nou' }, { section: 'membri' }, { section: 'rapoarte', filter: 'budget' }]);
  });

  it('the budget step needs the plan: a plan without budgets and reports does not offer it', () => {
    expect(startSteps(data(), canAs('admin'), starter).map((s) => s.key)).toEqual(['vehicle', 'members']);
  });

  it('a driver has no step', () => {
    expect(startSteps(data({ role: 'driver' }), canAs('driver'), business)).toEqual([]);
  });

  it('a member only gets the steps they may do', () => {
    for (const role of ['manager', 'accountant'] as const) {
      const keys = startSteps(data({ role }), canAs(role), business).map((s) => s.key);
      const can = canAs(role);
      expect(keys.includes('vehicle')).toBe(can('vehicles.manage'));
      expect(keys.includes('members')).toBe(can('members.manage'));
      expect(keys.includes('budget')).toBe(can('budget.manage') && can('reports.view'));
    }
  });
});
