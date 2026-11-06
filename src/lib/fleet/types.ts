import type { Quote, QuoteItem } from '../clientBookings';
import type { BookingStatus } from '../status';
import type { FleetReading, IgnoredJob, OdometerException } from './odometer';

/**
 * Fleet accounts (docs/FLEET_PLAN.md): the shapes the company read (`fleet_overview(company)`, a
 * proposed database function) will answer. Every figure on the fleet screens is computed from these
 * rows by the pure functions next to this file, the way Rapoarte does it for a shop
 * (src/lib/shopReports.ts): the database decides who sees which rows, the browser only sums them.
 */

export type FleetRole = 'admin' | 'manager' | 'driver' | 'accountant';
export const FLEET_ROLES: readonly FleetRole[] = ['admin', 'manager', 'driver', 'accountant'];

/** A company car: a `cars` row with `company_id` set (proposed columns marked so). */
export interface FleetVehicle {
  id: string;
  make: string;
  model: string;
  year: number | null;
  plate: string | null;
  vin: string | null;
  itp_expiry: string | null;
  rca_expiry: string | null;
  vignette_expiry: string | null;
  created_at: string;
  /** Proposed: retired from the fleet; history stays. */
  archived_at: string | null;
  /** Proposed: set by a manager when the car cannot be used (no booking explains it). */
  unavailable: boolean;
  /** Proposed: the member the car is assigned to. */
  driver_id: string | null;
  /** Proposed, optional. */
  department: string | null;
  /** Proposed, optional: `car`, `van`, `truck`, … */
  vehicle_type: string | null;
}

/** One line of a company quote: the same fields a client reads (variants, labor/part detail). */
export type FleetQuoteItem = QuoteItem;

/** The quote in force on a company booking (the same rows a client reads, plus who decided). */
export interface FleetQuote extends Quote {
  /** The member's account that decided (`quotes.decided_by_user`). */
  decided_by_member: string | null;
  decided_by_name?: string | null;
  items: FleetQuoteItem[];
}

/** A booking made in the company's space (`bookings.company_id`, T63d). */
export interface FleetJob {
  id: string;
  ref: string;
  vehicle_id: string;
  status: BookingStatus;
  date: string;
  slot: string;
  created_at: string;
  done_at: string | null;
  shop_id: string;
  shop_name: string;
  shop_city: string;
  /** The first service's catalog category (`cat_rev`, `cat_anv`, …). */
  service_category: string;
  service_name_ro: string;
  service_name_en: string;
  /** The services added to the booking (T21). */
  extra_services?: { name_ro: string; name_en: string }[];
  /** The member's account that booked it (the booking's client) and their name. */
  booked_by?: string | null;
  booked_by_name?: string;
  /** Only `done` jobs carry the final cost; refused quotes carry the inspection fee. */
  cost: number | null;
  odometer: number | null;
  work: string | null;
  warranty_until: string | null;
  quote: FleetQuote | null;
}

export const FLEET_CATEGORIES = [
  'repairs',
  'maintenance',
  'parts',
  'labor',
  'tires',
  'consumables',
  'itp',
  'insurance',
  'tolls',
  'fuel',
  'other',
] as const;
export type FleetCategory = (typeof FLEET_CATEGORIES)[number];

/** The categories an expense of the company's own can have (M1; `fleet_expenses.category`). */
export const EXPENSE_CATEGORIES = ['fuel', 'parts', 'repairs', 'labor', 'tolls', 'consumables', 'insurance', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const FUEL_TYPES = ['diesel', 'petrol', 'lpg', 'electric', 'other'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

/** A cost typed in by the company (`fleet_expenses`, M1). */
export interface FleetExpense {
  id: string;
  vehicle_id: string;
  category: FleetCategory;
  day: string;
  amount: number;
  currency: string;
  description: string | null;
  supplier: string | null;
  odometer: number | null;
  /** Set when the expense documents a Service-Hub job; such a job is already counted. */
  booking_id: string | null;
  created_at: string;
  created_by: string | null;
  deleted_at: string | null;
  /** Fuel only. */
  liters?: number | null;
  fuel_type?: FuelType | null;
  full_tank?: boolean | null;
  /** `<company>/<vehicle>/<file>` in the private bucket `fleet-files`. */
  receipt_path?: string | null;
  /** A driver's fuel arrives `to_check` until someone with costs.manage checks it. */
  status?: 'ok' | 'to_check';
  created_by_name?: string | null;
  updated_at?: string | null;
}

/** What the expense form sends (`fleet_save_expense`). */
export interface ExpenseFields {
  vehicle_id: string;
  category: ExpenseCategory;
  day: string;
  amount: number;
  currency?: string;
  supplier: string | null;
  description: string | null;
  odometer: number | null;
  liters?: number | null;
  fuel_type?: FuelType | null;
  full_tank?: boolean | null;
  booking_id?: string | null;
  receipt_path?: string | null;
  /** The member confirmed it is not a duplicate of an identical expense. */
  confirm_duplicate?: boolean;
}

export interface FleetMember {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  role: FleetRole;
  accepted_at: string | null;
  /** The rights the admin gave beyond the role (T63i) and the member's own approval limit. */
  extra_caps?: string[];
  approval_limit?: number | null;
}

export const ISSUE_KINDS = ['defect', 'damage', 'accident', 'technical', 'other'] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];
export const ISSUE_STATUSES = ['new', 'in_review', 'scheduled', 'resolved', 'closed'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** A reported issue or incident (`fleet_issues`, M3). Title and description stay as reported. */
export interface FleetIssue {
  id: string;
  vehicle_id: string;
  /** The vehicle as it was at report time. */
  vehicle_label: { plate: string | null; make: string; model: string };
  kind: IssueKind;
  title: string;
  description: string | null;
  happened_on: string;
  status: IssueStatus;
  booking_id: string | null;
  /** Storage paths in `fleet-files`. */
  photos: string[];
  /** The user who reported it. */
  reported_by: string | null;
  reported_by_name: string | null;
  created_at: string;
  updated_at: string | null;
}

/** One change of a report (`fleet_issue_events`). */
export interface FleetIssueEvent {
  id: number;
  from_status: IssueStatus | null;
  to_status: IssueStatus | null;
  note: string | null;
  booking_id: string | null;
  photos_added: number;
  by_name: string | null;
  at: string;
}

export interface FleetIssueDetail extends FleetIssue {
  events: FleetIssueEvent[];
}

/** What the report form sends. */
export interface IssueFields {
  vehicle_id: string;
  kind: IssueKind;
  title: string;
  description: string | null;
  happened_on: string;
  booking_id: string | null;
  photos: string[];
}

/** What a follow-up sends (issues.manage); a missing key changes nothing. */
export interface IssueUpdate {
  status?: IssueStatus;
  note?: string | null;
  booking_id?: string | null;
  add_photos?: string[];
}

export interface FleetBudget {
  monthly: number | null;
  yearly: number | null;
}

export interface FleetCompany {
  id: string;
  name: string;
  vat_id: string | null;
  plan_key: string;
  /** Managers approve quotes up to this total; null = no limit set by the company. */
  manager_approval_limit: number | null;
  budget: FleetBudget;
}

/** Everything one read answers, already narrowed to what the caller may see. */
export interface FleetOverview {
  company: FleetCompany;
  /** The member reading: role, the rights the admin gave (T63i) and their approval limit (own, else the company's). */
  me: { member_id: string; role: FleetRole; extra_caps?: string[]; approval_limit?: number | null };
  vehicles: FleetVehicle[];
  jobs: FleetJob[];
  expenses: FleetExpense[];
  members: FleetMember[];
  issues: FleetIssue[];
  /** M2: the odometer log, the jobs whose km is left out, the receipts the import could not take. */
  readings?: FleetReading[];
  ignored_jobs?: IgnoredJob[];
  odometer_exceptions?: OdometerException[];
}
