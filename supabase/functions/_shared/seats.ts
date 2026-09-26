// Paid staff accounts in Stripe (ARCHITECTURE §12): the subscription carries a second item,
// "Cont angajat" (STRIPE_SEAT_PRICE_ID, 19 lei a month), whose quantity is the shop's colleagues
// with an account. Changes are prorated by day both ways (Stripe's create_prorations). On a
// subscription paid for 3, 6 or 12 months the item costs the period's price per colleague (the
// same discount) and a change is invoiced at once (always_invoice), not at the next renewal.
//
// No Deno here: the unit tests run it against a fake Stripe.
import { periodPrice, recurringFor } from './periods.ts';
import type { StripeApi } from './stripe.ts';
import { hasLiveSubscription, StripeError } from './stripe.ts';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const idOf = (v: unknown): string | null =>
  typeof v === 'string' ? v || null : v && typeof v === 'object' ? ((v as { id?: string }).id ?? null) : null;

/** What stripe_seat_info answers. */
export interface SeatInfo {
  shop_id: string;
  seats: number;
  seat_price_ron: number;
  /** The subscription's period and its discount (a month and 0 unless paid for longer). */
  billing_months?: number;
  period_discount?: number;
  billed_seats: number | null;
  stripe_subscription_id: string | null;
  stripe_status: string | null;
}

/** The Stripe price of one colleague, read once per call. */
export interface SeatPrice {
  id: string;
  product: string | null;
  unitAmount: number | null;
  currency: string;
}

export async function seatPrice(stripe: StripeApi, priceId: string): Promise<SeatPrice> {
  const p = await stripe.get(`prices/${priceId}`);
  return {
    id: priceId,
    product: idOf(p.product),
    unitAmount: typeof p.unit_amount === 'number' ? p.unit_amount : null,
    currency: String(p.currency ?? '').toLowerCase(),
  };
}

/**
 * The Checkout line for `seats` colleagues at the shop's price per colleague: the Stripe price when
 * the amounts match, else the same product at the shop's amount (a shop keeps the price it signed
 * up with). For 3, 6 or 12 months, the period's price per colleague on the same product. Null when
 * there is nobody to pay for.
 */
export function seatLineItem(price: SeatPrice, seatPriceRon: number, seats: number, months = 1, discountPercent = 0): Obj | null {
  if (!(seats > 0)) return null;
  const amount = Math.round(periodPrice(seatPriceRon, months, discountPercent) * 100);
  if (months <= 1 && price.unitAmount === amount && price.currency === 'ron') return { price: price.id, quantity: seats };
  return {
    price_data: { currency: 'ron', product: price.product, unit_amount: amount, recurring: recurringFor(months) },
    quantity: seats,
  };
}

/** The item of a Stripe subscription that is the colleagues' one (same price or same product). */
export function seatItem(subscription: Obj, price: SeatPrice): Obj | null {
  const items = (obj(subscription.items).data as unknown[] | undefined) ?? [];
  for (const raw of items) {
    const item = obj(raw);
    const p = obj(item.price);
    if (idOf(item.price) === price.id || (price.product && idOf(p.product) === price.product)) return item;
  }
  return null;
}

/** How many colleagues a Stripe subscription charges for now. */
export function billedSeats(subscription: Obj, price: SeatPrice): number {
  const item = seatItem(subscription, price);
  return item && typeof item.quantity === 'number' ? item.quantity : 0;
}

export type SeatSyncStatus = 'no_subscription' | 'unchanged' | 'updated' | 'added' | 'removed';

/**
 * Makes Stripe charge for `info.seats` colleagues: changes the quantity of the colleagues' item,
 * adds it (the first colleague) or removes it (none left). Setting an absolute quantity is safe to
 * repeat; adding the item carries `requestKey` (the outbox event or the Stripe event being handled)
 * as idempotency key, so a retry of the same request never adds it twice.
 * Answers what it did and the quantity Stripe charges afterwards.
 */
export async function syncSeats(
  stripe: StripeApi,
  price: SeatPrice,
  info: SeatInfo,
  requestKey: string,
): Promise<{ status: SeatSyncStatus; billed: number | null }> {
  if (!info.stripe_subscription_id || !hasLiveSubscription(info.stripe_status)) return { status: 'no_subscription', billed: null };
  let sub: Obj;
  try {
    sub = await stripe.get(`subscriptions/${info.stripe_subscription_id}`);
  } catch (e) {
    if (e instanceof StripeError && e.status === 404) return { status: 'no_subscription', billed: null };
    throw e;
  }
  if (!hasLiveSubscription(String(sub.status ?? ''))) return { status: 'no_subscription', billed: null };

  const seats = Math.max(0, Math.floor(Number(info.seats) || 0));
  const months = Number(info.billing_months) || 1;
  // A month: prorated on the next invoice, as before. A longer period would leave the change for
  // months, so it is invoiced at once.
  const proration_behavior = months > 1 ? 'always_invoice' : 'create_prorations';
  const item = seatItem(sub, price);
  const now = item && typeof item.quantity === 'number' ? item.quantity : 0;
  if (item && now === seats) return { status: 'unchanged', billed: seats };
  if (!item && seats === 0) return { status: 'unchanged', billed: 0 };

  if (item && seats === 0) {
    await stripe.del(`subscription_items/${idOf(item.id)}`, { proration_behavior });
    return { status: 'removed', billed: 0 };
  }
  if (item) {
    await stripe.post(`subscription_items/${idOf(item.id)}`, { quantity: seats, proration_behavior });
    return { status: 'updated', billed: seats };
  }
  const line = seatLineItem(price, info.seat_price_ron, seats, months, Number(info.period_discount) || 0)!;
  await stripe.post(
    'subscription_items',
    { subscription: info.stripe_subscription_id, ...line, proration_behavior },
    `seat-item-${info.stripe_subscription_id}-${requestKey}`,
  );
  return { status: 'added', billed: seats };
}
