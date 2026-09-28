import { describe, expect, it } from 'vitest';
import { giveReferralCredit, toBani, type ReferralCreditInfo } from '../../supabase/functions/_shared/referrals';
import type { StripeApi } from '../../supabase/functions/_shared/stripe';

function fakeStripe() {
  const calls: { path: string; params?: Record<string, unknown>; key?: string }[] = [];
  const api: StripeApi = {
    get: async () => ({}),
    post: async (path, params, key) => {
      calls.push({ path, params, key });
      return { id: 'cbtxn_1' };
    },
    del: async () => ({}),
  };
  return { api, calls };
}

const info = (over: Partial<ReferralCreditInfo> = {}): ReferralCreditInfo => ({
  customer: 'cus_1',
  amount: '149.00',
  applied: false,
  referred_name: 'Auto Nou',
  ...over,
});

describe('a referral credit in Stripe', () => {
  it('converts lei to bani', () => {
    expect(toBani('149.00')).toBe(14900);
    expect(toBani(99.5)).toBe(9950);
    expect(toBani(null)).toBe(0);
    expect(toBani('x')).toBe(0);
  });

  it('credits one month on the customer, keyed by the referral so a retry gives nothing more', async () => {
    const { api, calls } = fakeStripe();
    expect(await giveReferralCredit(api, 'shop_new', info())).toEqual({ status: 'credited', transaction: 'cbtxn_1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('customers/cus_1/balance_transactions');
    expect(calls[0]!.key).toBe('referral-credit-shop_new');
    expect(calls[0]!.params).toMatchObject({
      amount: -14900,
      currency: 'ron',
      metadata: { kind: 'referral', referral_shop_id: 'shop_new' },
    });
    expect(String(calls[0]!.params!.description)).toContain('Auto Nou');
  });

  it('does nothing when already given, without a customer or without an amount', async () => {
    const { api, calls } = fakeStripe();
    expect(await giveReferralCredit(api, 'r', info({ applied: true }))).toEqual({ status: 'already' });
    expect(await giveReferralCredit(api, 'r', info({ customer: null }))).toEqual({ status: 'no_customer' });
    expect(await giveReferralCredit(api, 'r', info({ amount: 0 }))).toEqual({ status: 'nothing' });
    expect(calls).toHaveLength(0);
  });
});
