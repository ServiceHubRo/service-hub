import { ymdInBucharest } from '../../i18n/format';
import { buildLedger, budgetUsage, filterCosts, monthRange, sumAmounts, yearRange, averagePerVehicle, type BudgetUsage, type Ledger } from './costs';
import { can } from './permissions';
import type { FleetJob, FleetOverview } from './types';
import { documentStates, needsAttention, vehicleStatus } from './vehicles';

/**
 * The fleet's Panou (docs/FLEET_PLAN.md §4): the headline figures and the recent activity, from the
 * one company read. Money is left out (null) for a member whose role does not see costs, so a
 * driver's screen never holds an amount, not even hidden.
 */

export interface FleetKpis {
  vehicles: number;
  active: number;
  inService: number;
  upcoming: number;
  quotesWaiting: number;
  docsExpiring: number;
  monthSpend: number | null;
  yearSpend: number | null;
  avgPerVehicle: number | null;
  monthBudget: BudgetUsage | null;
  yearBudget: BudgetUsage | null;
}

/** Ledger only for roles that see costs. */
export function ledgerFor(data: FleetOverview): Ledger | null {
  return can(data.me.role, 'costs.view') ? buildLedger(data.jobs, data.expenses) : null;
}

export function fleetKpis(data: FleetOverview, now: Date = new Date()): FleetKpis {
  const today = ymdInBucharest(now);
  const fleet = data.vehicles.filter((v) => !v.archived_at);
  const statuses = fleet.map((v) => vehicleStatus(v, data.jobs));
  const ledger = ledgerFor(data);
  const month = ledger ? sumAmounts(filterCosts(ledger.entries, { range: monthRange(today) })) : null;
  const year = ledger ? sumAmounts(filterCosts(ledger.entries, { range: yearRange(today) })) : null;
  return {
    vehicles: fleet.length,
    active: statuses.filter((s) => s === 'active').length,
    inService: statuses.filter((s) => s === 'in_service').length,
    upcoming: data.jobs.filter((j) => (j.status === 'pending' || j.status === 'confirmed') && j.date >= today).length,
    quotesWaiting: data.jobs.filter((j) => j.status === 'quote_sent').length,
    docsExpiring: documentStates(fleet, now).filter(needsAttention).length,
    monthSpend: month,
    yearSpend: year,
    avgPerVehicle: ledger ? averagePerVehicle(ledger.entries, data.vehicles, yearRange(today)) : null,
    monthBudget: month === null ? null : budgetUsage(data.company.budget.monthly, month),
    yearBudget: year === null ? null : budgetUsage(data.company.budget.yearly, year),
  };
}

// ------------------------------------------------------------------ the stage of a job

/**
 * Where a company booking stands, in the words the fleet needs: an estimate is not an approval, an
 * approval is not a cost, and only a finished job has a confirmed final cost.
 */
export type JobStage = 'requested' | 'inspection' | 'estimate' | 'approved' | 'in_progress' | 'final' | 'refused' | 'closed';

export function jobStage(job: FleetJob): JobStage {
  switch (job.status) {
    case 'pending':
    case 'confirmed':
      return 'requested';
    case 'in_inspection':
      return 'inspection';
    case 'quote_sent':
      return 'estimate';
    case 'approved':
      return 'approved';
    case 'in_progress':
      return 'in_progress';
    case 'done':
      return 'final';
    case 'quote_refused':
      return 'refused';
    default:
      return 'closed';
  }
}

// ------------------------------------------------------------------ recent activity

export type ActivityKind =
  | 'booking_created'
  | 'quote_received'
  | 'quote_approved'
  | 'quote_refused'
  | 'job_done'
  | 'expense_added'
  | 'vehicle_added'
  | 'issue_reported';

export interface Activity {
  id: string;
  kind: ActivityKind;
  at: string;
  vehicle_id: string;
  /** Null when the caller may not see money, or the event carries none. */
  amount: number | null;
  /** The shop, the supplier, or the issue's first words. */
  detail: string | null;
  /** Set for a booking, so the row can open it. */
  job_id: string | null;
}

export function recentActivity(data: FleetOverview, limit = 12): Activity[] {
  const money = can(data.me.role, 'costs.view');
  const amount = (n: number | null | undefined) => (money && n !== null && n !== undefined ? n : null);
  const out: Activity[] = [];
  for (const j of data.jobs) {
    out.push({ id: `b:${j.id}`, kind: 'booking_created', at: j.created_at, vehicle_id: j.vehicle_id, amount: null, detail: j.shop_name, job_id: j.id });
    const q = j.quote;
    if (q) {
      out.push({ id: `q:${q.id}`, kind: 'quote_received', at: q.sent_at, vehicle_id: j.vehicle_id, amount: amount(q.total_sent), detail: j.shop_name, job_id: j.id });
      if (q.decided_at && (q.status === 'accepted' || q.status === 'partially_accepted')) {
        out.push({ id: `qa:${q.id}`, kind: 'quote_approved', at: q.decided_at, vehicle_id: j.vehicle_id, amount: amount(q.total_approved), detail: j.shop_name, job_id: j.id });
      }
      if (q.decided_at && q.status === 'refused') {
        out.push({ id: `qr:${q.id}`, kind: 'quote_refused', at: q.decided_at, vehicle_id: j.vehicle_id, amount: null, detail: j.shop_name, job_id: j.id });
      }
    }
    if (j.status === 'done' && j.done_at) {
      out.push({ id: `d:${j.id}`, kind: 'job_done', at: j.done_at, vehicle_id: j.vehicle_id, amount: amount(j.cost), detail: j.shop_name, job_id: j.id });
    }
  }
  if (money) {
    for (const e of data.expenses) {
      if (e.deleted_at) continue;
      out.push({ id: `e:${e.id}`, kind: 'expense_added', at: e.created_at, vehicle_id: e.vehicle_id, amount: e.amount, detail: e.supplier, job_id: null });
    }
  }
  for (const v of data.vehicles) {
    out.push({ id: `v:${v.id}`, kind: 'vehicle_added', at: v.created_at, vehicle_id: v.id, amount: null, detail: null, job_id: null });
  }
  for (const i of data.issues) {
    out.push({ id: `i:${i.id}`, kind: 'issue_reported', at: i.created_at, vehicle_id: i.vehicle_id, amount: null, detail: i.body, job_id: null });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, limit);
}
