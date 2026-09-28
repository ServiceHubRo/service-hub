// Shop referrals in Stripe (ARCHITECTURE §12): a shop that brought another one gets one month of
// its subscription off its next invoice, as a credit on its Stripe customer (a negative customer
// balance transaction, which Stripe uses up on the next invoices by itself). The referral's id is
// the idempotency key, so a retry never gives the credit twice.
//
// No Deno here: the unit tests run it against a fake Stripe.
import type { StripeApi } from './stripe.ts';

/** What referral_credit_info answers. */
export interface ReferralCreditInfo {
  customer: string | null;
  amount: number | string | null;
  applied: boolean;
  referred_name: string | null;
}

export type ReferralCreditResult =
  | { status: 'credited'; transaction: string }
  | { status: 'already' | 'no_customer' | 'nothing' };

/** Lei to bani, for Stripe's smallest unit. */
export function toBani(lei: number | string | null): number {
  const n = typeof lei === 'number' ? lei : Number(lei ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export async function giveReferralCredit(
  stripe: StripeApi,
  referralShopId: string,
  info: ReferralCreditInfo,
): Promise<ReferralCreditResult> {
  if (info.applied) return { status: 'already' };
  if (!info.customer) return { status: 'no_customer' };
  const bani = toBani(info.amount);
  if (bani <= 0) return { status: 'nothing' };
  const name = (info.referred_name ?? '').trim();
  const txn = await stripe.post(
    `customers/${info.customer}/balance_transactions`,
    {
      amount: -bani,
      currency: 'ron',
      description: `Service-Hub: o lună gratuită pentru recomandare${name ? ` (${name})` : ''}`.slice(0, 350),
      metadata: { kind: 'referral', referral_shop_id: referralShopId },
    },
    `referral-credit-${referralShopId}`,
  );
  return { status: 'credited', transaction: String(txn.id ?? '') };
}

// ------------------------------------------------------------------------------------ taking it back

/** What referral_reversal_info answers. */
export interface ReferralReversalInfo {
  customer: string | null;
  amount: number | string | null;
  done: boolean;
  referred_name: string | null;
}

export type ReferralReversalResult =
  | { status: 'reversed'; amount: number; transaction: string }
  | { status: 'used' | 'already' | 'no_customer' };

/**
 * The payment that earned a referral was refunded or disputed: takes back only the part of the
 * credit still on the customer's balance (a negative balance is credit). What an invoice already
 * used stays; nothing more is charged.
 */
export async function takeBackReferralCredit(
  stripe: StripeApi,
  referralShopId: string,
  info: ReferralReversalInfo,
): Promise<ReferralReversalResult> {
  if (info.done) return { status: 'already' };
  if (!info.customer) return { status: 'no_customer' };
  const customer = await stripe.get(`customers/${info.customer}`);
  const unused = Math.max(0, -Number(customer.balance ?? 0));
  const bani = Math.min(toBani(info.amount), unused);
  if (bani <= 0) return { status: 'used' };
  const name = (info.referred_name ?? '').trim();
  const txn = await stripe.post(
    `customers/${info.customer}/balance_transactions`,
    {
      amount: bani,
      currency: 'ron',
      description: `Service-Hub: luna gratuită pentru recomandare anulată${name ? ` (${name})` : ''}`.slice(0, 350),
      metadata: { kind: 'referral_reversal', referral_shop_id: referralShopId },
    },
    `referral-reversal-${referralShopId}`,
  );
  return { status: 'reversed', amount: bani / 100, transaction: String(txn.id ?? '') };
}

type Obj = Record<string, unknown>;
const idOf = (v: unknown): string | null =>
  typeof v === 'string' ? v || null : v && typeof v === 'object' ? ((v as { id?: string }).id ?? null) : null;

/**
 * A refunded or disputed charge, as the webhook needs it: the customer, the invoice it paid, and
 * whether it counts (the whole amount refunded, or any dispute). The invoice is found through its
 * payment (Stripe's invoice_payments, API 2025-03-31 and later: a charge no longer names its invoice).
 */
export async function reversedPayment(
  stripe: StripeApi,
  kind: 'refunded' | 'disputed',
  object: Obj,
): Promise<{ customer: string; invoice: string } | null> {
  const chargeId = kind === 'disputed' ? idOf(object.charge) : idOf(object.id);
  if (!chargeId) return null;
  const charge = await stripe.get(`charges/${chargeId}`);
  if (kind === 'refunded') {
    const amount = Number(charge.amount ?? 0);
    if (charge.refunded !== true && !(amount > 0 && Number(charge.amount_refunded ?? 0) >= amount)) return null;
  }
  const customer = idOf(charge.customer);
  const intent = idOf(charge.payment_intent);
  if (!customer || !intent) return null;
  const list = await stripe.get('invoice_payments', { payment: { type: 'payment_intent', payment_intent: intent }, limit: 1 });
  const invoice = idOf(((list.data as Obj[] | undefined) ?? [])[0]?.invoice);
  return invoice ? { customer, invoice } : null;
}
