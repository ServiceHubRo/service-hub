// Billing periods (ARCHITECTURE §12): a shop pays every month, or for 3, 6 or 12 months at once
// with a discount (Setări platformă). The price of a period mirrors subscription_period_price() in
// the database and periodPrice() in src/lib/subscription.ts; the unit tests hold all three to the
// same figures.
//
// No Deno here: the unit tests import it.

export const BILLING_MONTHS = [1, 3, 6, 12] as const;
export type BillingMonths = (typeof BILLING_MONTHS)[number];

export function isBillingMonths(v: unknown): v is BillingMonths {
  return typeof v === 'number' && (BILLING_MONTHS as readonly number[]).includes(v);
}

/** A monthly price for a period: the same for one month, else months × price less the discount, in whole lei. */
export function periodPrice(monthly: number, months: number, discountPercent: number): number {
  if (!(months > 1)) return Number(monthly);
  const cents = Math.round(Number(monthly) * 100) * months * (100 - (Number(discountPercent) || 0));
  return Math.round(cents / 10_000);
}

/** Stripe's `recurring` for a period (a month stays `{ interval: 'month' }`, as before). */
export function recurringFor(months: number): Record<string, unknown> {
  return months > 1 ? { interval: 'month', interval_count: months } : { interval: 'month' };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

/** How many months a Stripe subscription's price covers (its first item); 1 when it cannot tell. */
export function billingMonthsOf(sub: Obj): number {
  const item = obj((obj(sub.items).data as unknown[] | undefined)?.[0]);
  const recurring = obj(obj(item.price).recurring);
  const count = typeof recurring.interval_count === 'number' && recurring.interval_count > 0 ? recurring.interval_count : 1;
  if (recurring.interval === 'year') return 12 * count;
  return recurring.interval === 'month' ? count : 1;
}
