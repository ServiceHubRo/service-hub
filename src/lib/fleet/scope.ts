import { can } from './permissions';
import type { FleetOverview, FleetRole } from './types';

/**
 * What the company read answers each role (docs/FLEET_PLAN.md §3.3). The database function
 * `fleet_overview` (proposed) must give exactly this; the design preview uses it on its sample, and a
 * future SQL test checks the same cases. A driver gets the cars assigned to them and their bookings
 * with every amount removed, no expenses and no other members.
 */
export function scopeFor(data: FleetOverview, role: FleetRole, memberId: string): FleetOverview {
  const me = { member_id: memberId, role };
  if (can(role, 'vehicles.viewAll')) return { ...data, me };
  const vehicles = data.vehicles.filter((v) => v.driver_id === memberId && !v.archived_at);
  const ids = new Set(vehicles.map((v) => v.id));
  return {
    company: { ...data.company, manager_approval_limit: null, budget: { monthly: null, yearly: null } },
    me,
    vehicles,
    jobs: data.jobs
      .filter((j) => ids.has(j.vehicle_id))
      .map((j) => ({
        ...j,
        cost: null,
        quote: j.quote && {
          ...j.quote,
          total_sent: 0,
          total_approved: null,
          items: j.quote.items.map((i) => ({ ...i, price: 0 })),
        },
      })),
    expenses: [],
    members: data.members.filter((m) => m.id === memberId),
    issues: data.issues.filter((i) => ids.has(i.vehicle_id)),
  };
}
