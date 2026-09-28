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
