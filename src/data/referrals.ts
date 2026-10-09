import { call } from './rpc';

/**
 * Shop referrals (after T21): a shop brings another one with its code (the owner's S- number);
 * when the new shop pays its first subscription, the referrer gets a free month. Everything is
 * decided in the database; the browser only checks a code at sign-up and shows the owner's list.
 */

export type ReferralState = 'trial' | 'waiting' | 'rewarded' | 'refused' | 'revoked';
/** Why nothing was given (refused), or why it was taken back (revoked: refunded, disputed). */
export type ReferralRefusal = 'same_person' | 'trial_used' | 'same_company' | 'referrer_gone' | 'limit' | 'refunded' | 'disputed';

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

// ------------------------------------------------------------------ invite a friend (clients, T35)

/**
 * A client invites a friend with their code (C-00042); when a shop finishes the friend's first job
 * booked in the app, the client gets a free history report. The invitations themselves are never
 * readable from the browser: only these counts.
 */
export interface MyInvites {
  code: string;
  invited: number;
  rewarded: number;
  creditsAvailable: number;
  creditsPerYear: number;
  /** Friends with a first completed job that bring one free report (admin setting, 2). */
  friendsPerReport: number;
  /** Friends counted towards the next report. */
  progress: number;
}

/** Does this code belong to a client? Callable before signing in (the sign-up form). */
export async function checkClientInviteCode(code: string): Promise<boolean> {
  return (await call('check_client_invite_code', { p_code: code.trim() })) === true;
}

/** The client's code and counts; null for anyone else. */
export async function getMyInvites(): Promise<MyInvites | null> {
  const raw = (await call('my_client_referrals', undefined as never)) as unknown as Record<string, unknown> | null;
  if (!raw) return null;
  return {
    code: String(raw.code ?? ''),
    invited: Number(raw.invited ?? 0),
    rewarded: Number(raw.rewarded ?? 0),
    creditsAvailable: Number(raw.credits_available ?? 0),
    creditsPerYear: Number(raw.credits_per_year ?? 0),
    friendsPerReport: Math.max(1, Number(raw.friends_per_report ?? 1)),
    progress: Number(raw.progress ?? 0),
  };
}
