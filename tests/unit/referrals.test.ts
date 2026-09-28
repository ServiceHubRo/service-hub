import { describe, expect, it } from 'vitest';
import {
  giveReferralCredit,
  reversedPayment,
  takeBackReferralCredit,
  toBani,
  type ReferralCreditInfo,
} from '../../supabase/functions/_shared/referrals';
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

describe('taking a referral credit back', () => {
  function stripeWith(objects: Record<string, Record<string, unknown>>) {
    const posts: { path: string; params?: Record<string, unknown>; key?: string }[] = [];
    const gets: { path: string; params?: Record<string, unknown> }[] = [];
    const api: StripeApi = {
      get: async (path, params) => {
        gets.push({ path, params });
        return objects[path] ?? {};
      },
      post: async (path, params, key) => {
        posts.push({ path, params, key });
        return { id: 'cbtxn_back' };
      },
      del: async () => ({}),
    };
    return { api, posts, gets };
  }
  const back = { customer: 'cus_1', amount: '149.00', done: false, referred_name: 'Auto Nou' };

  it('takes back the whole credit while it is unused, once', async () => {
    const { api, posts } = stripeWith({ 'customers/cus_1': { balance: -14900 } });
    expect(await takeBackReferralCredit(api, 'shop_new', back)).toEqual({ status: 'reversed', amount: 149, transaction: 'cbtxn_back' });
    expect(posts[0]).toMatchObject({ path: 'customers/cus_1/balance_transactions', key: 'referral-reversal-shop_new' });
    expect(posts[0]!.params).toMatchObject({ amount: 14900, currency: 'ron' });
  });

  it('takes back only what is left, and nothing once an invoice used it', async () => {
    const part = stripeWith({ 'customers/cus_1': { balance: -5000 } });
    expect(await takeBackReferralCredit(part.api, 'r', back)).toMatchObject({ status: 'reversed', amount: 50 });
    expect(part.posts[0]!.params).toMatchObject({ amount: 5000 });
    const used = stripeWith({ 'customers/cus_1': { balance: 0 } });
    expect(await takeBackReferralCredit(used.api, 'r', back)).toEqual({ status: 'used' });
    expect(used.posts).toHaveLength(0);
    expect(await takeBackReferralCredit(used.api, 'r', { ...back, done: true })).toEqual({ status: 'already' });
  });

  it('finds the invoice of a fully refunded or disputed charge, not of a partial refund', async () => {
    const objects = {
      'charges/ch_1': { id: 'ch_1', amount: 9900, amount_refunded: 9900, refunded: true, customer: 'cus_9', payment_intent: 'pi_1' },
      'charges/ch_2': { id: 'ch_2', amount: 9900, amount_refunded: 1000, refunded: false, customer: 'cus_9', payment_intent: 'pi_2' },
      invoice_payments: { data: [{ invoice: 'in_1' }] },
    };
    const { api, gets } = stripeWith(objects);
    expect(await reversedPayment(api, 'refunded', { id: 'ch_1' })).toEqual({ customer: 'cus_9', invoice: 'in_1' });
    expect(gets.at(-1)).toEqual({ path: 'invoice_payments', params: { payment: { type: 'payment_intent', payment_intent: 'pi_1' }, limit: 1 } });
    expect(await reversedPayment(api, 'refunded', { id: 'ch_2' })).toBeNull();
    expect(await reversedPayment(api, 'disputed', { id: 'dp_1', charge: 'ch_2' })).toEqual({ customer: 'cus_9', invoice: 'in_1' });
    expect(await reversedPayment(api, 'disputed', { id: 'dp_2' })).toBeNull();
  });
});
