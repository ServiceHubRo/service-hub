import { call } from './rpc';

/**
 * Shop referrals (after T21): a shop brings another one with its code (the owner's S- number);
 * when the new shop pays its first subscription, the referrer gets a free month. Everything is
 * decided in the database; the browser only checks a code at sign-up and shows the owner's list.
 */

export type ReferralState = 'trial' | 'waiting' | 'rewarded' | 'refused';
export type ReferralRefusal = 'same_person' | 'trial_used' | 'same_company' | 'referrer_gone' | 'limit';

export interface ReferralItem {
  name: string;
  city: string;
  joined_at: string;
  state: ReferralState;
  reason: ReferralRefusal | null;
  reward_kind: 'trial_days' | 'stripe_credit' | null;
  reward_days: number | null;
  reward_amount: number | null;
  applied: boolean;
}

export interface MyReferrals {
  code: string;
  maxRewards: number;
  trialDays: number;
  rewarded: number;
  items: ReferralItem[];
}

interface RawReferrals {
  code: string;
  max_rewards: number;
  trial_days: number;
  rewarded: number;
  items: (Omit<ReferralItem, 'reward_amount'> & { reward_amount: number | string | null })[];
}

/** Does this code belong to a shop? Callable before signing in (the sign-up form). */
export async function checkReferralCode(code: string): Promise<boolean> {
  return (await call('check_referral_code', { p_code: code.trim() })) === true;
}

/** The owner's code and the shops it brought; null for a colleague. */
export async function getMyReferrals(): Promise<MyReferrals | null> {
  const raw = (await call('my_referrals', undefined as never)) as unknown as RawReferrals | null;
  if (!raw) return null;
  return {
    code: raw.code,
    maxRewards: raw.max_rewards,
    trialDays: raw.trial_days,
    rewarded: raw.rewarded,
    items: (raw.items ?? []).map((i) => ({ ...i, reward_amount: i.reward_amount === null ? null : Number(i.reward_amount) })),
  };
}
