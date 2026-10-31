import { daysFromToday, ymdInBucharest } from '../../i18n/format';

/**
 * Fleet plans (T64a, docs/FLEET_BILLING_PLAN.md §B): what a company's plan allows and where its
 * subscription stands. The database decides (`company_plan`, the limit triggers); these mirror it to
 * draw the Abonament page, the badge and the banners.
 */

/** Every feature a plan can list, in the order the comparison shows them. `available` = built. */
export const PLAN_FEATURES = [
  { key: 'dashboard', available: true },
  { key: 'vehicles', available: true },
  { key: 'doc_alerts', available: true },
  { key: 'history', available: true },
  { key: 'costs_basic', available: true },
  { key: 'members', available: true },
  { key: 'reports', available: true },
  { key: 'export_csv', available: true },
  { key: 'budget', available: true },
  { key: 'cost_per_km', available: true },
  // Not built yet: never offered on the comparison until it is.
  { key: 'approval_flow', available: false },
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number]['key'];

export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'cancelled' | 'inactive';

/** What `fleet_plan_summary` answers (every member) — `fleet_subscription().plan` adds the price. */
export interface FleetPlanSummary {
  plan_key: string;
  name_ro: string;
  name_en: string;
  vehicle_limit: number | null;
  member_limit: number | null;
  features: string[];
  status: SubscriptionStatus;
  ended_reason: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  read_only: boolean;
  billing_enabled: boolean;
  /** Active vehicles now. */
  vehicles: number;
}

export interface FleetPlanRow {
  key: string;
  name_ro: string;
  name_en: string;
  price_ron: number | null;
  vehicle_limit: number | null;
  member_limit: number | null;
  features: string[];
}

export interface FleetSubscriptionView {
  plan: Omit<FleetPlanSummary, 'vehicles'> & { price_ron: number | null; billing_months: number };
  usage: { vehicles: number; members: number };
  plans: FleetPlanRow[];
}

export function hasFeature(plan: Pick<FleetPlanSummary, 'features'> | null, feature: PlanFeature): boolean {
  // The design preview has no plan: everything shows.
  return plan === null || plan.features.includes(feature);
}

/** The features a plan is sold with: only those built (never a promise). */
export function offeredFeatures(features: readonly string[]): PlanFeature[] {
  return PLAN_FEATURES.filter((f) => f.available && features.includes(f.key)).map((f) => f.key);
}

/** Whole days left of the trial, counted in Bucharest calendar days; 0 on its last day or after. */
export function trialDaysLeft(trialEndsAt: string | null, now: Date = new Date()): number | null {
  if (!trialEndsAt) return null;
  return Math.max(0, daysFromToday(ymdInBucharest(new Date(trialEndsAt)), now));
}

/** How much of the trial is used, 0–1 (the bar). */
export function trialUsed(startedAt: string | null, endsAt: string | null, now: Date = new Date()): number {
  if (!startedAt || !endsAt) return 0;
  const start = new Date(startedAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!(end > start)) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

/**
 * Where the subscription stands, in the words the page uses: on trial, trial over (only shown as
 * such; blocking needs billing on), active, payment failed, cancelled, or not paid.
 */
export type PlanState = 'trial' | 'trial_over' | 'active' | 'past_due' | 'cancelled' | 'inactive';

export function planState(plan: Pick<FleetPlanSummary, 'status' | 'trial_ends_at'>, now: Date = new Date()): PlanState {
  if (plan.status === 'trial') return plan.trial_ends_at && new Date(plan.trial_ends_at) <= now ? 'trial_over' : 'trial';
  return plan.status;
}

/** Over a limit (after a downgrade, or a limit the admin lowered): never when there is none. */
export function overLimit(count: number, limit: number | null): number {
  return limit === null ? 0 : Math.max(0, count - limit);
}

/** The trial warning shows in its last week. */
export const TRIAL_WARN_DAYS = 7;
