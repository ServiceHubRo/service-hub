import type { FleetRole } from './types';

/**
 * Who may do what in a company (docs/FLEET_PLAN.md §6). This table is the browser's copy of the
 * rule the database will enforce (`fleet_can(company, capability)`, proposed): the app uses it only
 * to choose what to draw. Hiding a button is never the protection.
 */
export type FleetCapability =
  | 'company.manage'
  | 'members.manage'
  | 'subscription.manage'
  | 'budget.manage'
  | 'vehicles.viewAll'
  | 'vehicles.manage'
  | 'bookings.create'
  | 'bookings.viewAll'
  | 'quotes.approve'
  | 'costs.view'
  | 'costs.manage'
  | 'reports.view'
  | 'documents.view'
  | 'documents.manage'
  | 'issues.report'
  | 'issues.manage'
  | 'audit.view';

export const FLEET_CAPABILITIES: readonly FleetCapability[] = [
  'company.manage',
  'members.manage',
  'subscription.manage',
  'budget.manage',
  'vehicles.viewAll',
  'vehicles.manage',
  'bookings.create',
  'bookings.viewAll',
  'quotes.approve',
  'costs.view',
  'costs.manage',
  'reports.view',
  'documents.view',
  'documents.manage',
  'issues.report',
  'issues.manage',
  'audit.view',
];

const MANAGER: readonly FleetCapability[] = [
  'vehicles.viewAll',
  'vehicles.manage',
  'bookings.create',
  'bookings.viewAll',
  'quotes.approve',
  'costs.view',
  'costs.manage',
  'reports.view',
  'documents.view',
  'documents.manage',
  'issues.report',
  'issues.manage',
];

/**
 * A driver sees only the cars assigned to them; `bookings.create` and `documents.view` are limited to
 * those cars (the database checks the vehicle, T63d).
 */
const DRIVER: readonly FleetCapability[] = ['bookings.create', 'issues.report', 'documents.view'];

/** Money and papers, never bookings or approvals. */
const ACCOUNTANT: readonly FleetCapability[] = [
  'vehicles.viewAll',
  'bookings.viewAll',
  'costs.view',
  'costs.manage',
  'reports.view',
  'documents.view',
  'audit.view',
];

const MATRIX: Record<FleetRole, ReadonlySet<FleetCapability>> = {
  admin: new Set(FLEET_CAPABILITIES),
  manager: new Set(MANAGER),
  driver: new Set(DRIVER),
  accountant: new Set(ACCOUNTANT),
};

export function can(role: FleetRole, capability: FleetCapability): boolean {
  return MATRIX[role].has(capability);
}

export type ApprovalDecision = 'allowed' | 'over_limit' | 'not_allowed';

/**
 * Whether a member may approve a quote for `amount` (the total of the lines being approved):
 * the admin always; a manager up to the company's limit (none set = any amount); nobody else.
 */
export function approvalDecision(role: FleetRole, amount: number, managerLimit: number | null): ApprovalDecision {
  if (role === 'admin') return 'allowed';
  if (role !== 'manager') return 'not_allowed';
  if (managerLimit === null) return 'allowed';
  return amount <= managerLimit ? 'allowed' : 'over_limit';
}
