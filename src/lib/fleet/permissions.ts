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

/**
 * The rights the admin may give one member beyond their role (T63i), in the order the company page
 * shows them. Each tick of the page is one or two of them (`RIGHT_TICKS`). The company's details, the
 * subscription, roles and the administration are never given.
 */
export const GRANTABLE_CAPABILITIES = [
  'quotes.approve',
  'budget.manage',
  'bookings.create',
  'vehicles.manage',
  'costs.view',
  'reports.view',
  'members.manage',
] as const satisfies readonly FleetCapability[];
export type GrantableCapability = (typeof GRANTABLE_CAPABILITIES)[number];

/** The ticks of "Drepturi": one label each; "costs" gives costs and reports together. */
export const RIGHT_TICKS: readonly { key: string; caps: readonly GrantableCapability[] }[] = [
  { key: 'approve', caps: ['quotes.approve'] },
  { key: 'budget', caps: ['budget.manage'] },
  { key: 'book', caps: ['bookings.create'] },
  { key: 'vehicles', caps: ['vehicles.manage'] },
  { key: 'costs', caps: ['costs.view', 'reports.view'] },
  { key: 'members', caps: ['members.manage'] },
];

/**
 * What a member may do: their role's rights, the rights the admin gave and what those need to be
 * used (approving sees all vehicles, bookings and costs; managing vehicles sees them all; the budget
 * sees the costs). The database's `fleet_member_can` is the same rule (a SQL test proves it).
 */
export function memberCan(role: FleetRole, extra: readonly string[] | null | undefined, capability: FleetCapability): boolean {
  if (can(role, capability)) return true;
  const given = new Set(extra ?? []);
  if (given.has(capability)) return true;
  if (given.has('quotes.approve') && (capability === 'vehicles.viewAll' || capability === 'bookings.viewAll' || capability === 'costs.view')) return true;
  if (given.has('vehicles.manage') && capability === 'vehicles.viewAll') return true;
  return given.has('budget.manage') && capability === 'costs.view';
}

export type ApprovalDecision = 'allowed' | 'over_limit' | 'not_allowed';

/**
 * Whether a member may approve a quote for `amount` (the total of the lines being approved):
 * the admin always; anyone with the right to approve (a manager by role, others when the admin gave
 * it) up to their limit — their own, else the company's; none set = any amount.
 */
export function approvalDecision(role: FleetRole, amount: number, limit: number | null, extra: readonly string[] = []): ApprovalDecision {
  if (role === 'admin') return 'allowed';
  if (!memberCan(role, extra, 'quotes.approve')) return 'not_allowed';
  if (limit === null) return 'allowed';
  return amount <= limit ? 'allowed' : 'over_limit';
}
