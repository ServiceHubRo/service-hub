import type { Quote, QuoteItem } from '../clientBookings';
import type { BookingStatus } from '../status';

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

/** A cost typed in by the company (`fleet_expenses`, proposed). */
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
  created_by: string;
  deleted_at: string | null;
}

export interface FleetMember {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  role: FleetRole;
  accepted_at: string | null;
}

/** A driver's report about a car (`fleet_issues`, proposed). */
export interface FleetIssue {
  id: string;
  vehicle_id: string;
  kind: 'problem' | 'incident' | 'note';
  body: string;
  status: 'open' | 'scheduled' | 'closed';
  reported_by: string;
  created_at: string;
  booking_id: string | null;
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
  me: { member_id: string; role: FleetRole };
  vehicles: FleetVehicle[];
  jobs: FleetJob[];
  expenses: FleetExpense[];
  members: FleetMember[];
  issues: FleetIssue[];
}
