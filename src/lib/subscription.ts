import { daysFromToday, ymdInBucharest } from '../i18n/format';
import { translate, type Lang } from '../i18n/translate';

/**
 * Where a shop's subscription stands (FR §4.7, ARCHITECTURE §5, §12), from its row as the owner
 * reads it. Mirrors `subscription_ok()` in the database: good standing is active, past due (Stripe
 * is still retrying) or the free period — which also covers a card given in the free period
 * (Stripe `trialing`), charged when it ends.
 */
export interface SubscriptionRow {
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  price_ron: number;
  /** Price per colleague, how many colleagues are included, and how many pay (those beyond the included ones). */
  seat_price_ron: number;
  free_seats: number;
  seats: number;
  stripe_customer_id: string | null;
  stripe_status: string | null;
  ended_reason: string | null;
  next_payment_attempt: string | null;
  created_at: string;
}

/**
 *   trial       free period, no card given
 *   trial_card  free period, card given: charged at its end
 *   active      paid, renews every month
 *   ending      paid, stops at the end of the month (cancelled by the owner)
 *   past_due    a payment failed, Stripe retries; still in search
 *   inactive    free period over without a card, or the last try failed
 *   cancelled   ended after the owner cancelled
 */
export type SubscriptionState = 'trial' | 'trial_card' | 'active' | 'ending' | 'past_due' | 'inactive' | 'cancelled';

export type Tone = 'amber' | 'green' | 'red' | 'muted';

export const STATE_TONE: Record<SubscriptionState, Tone> = {
  trial: 'amber',
  trial_card: 'green',
  active: 'green',
  ending: 'amber',
  past_due: 'red',
  inactive: 'red',
  cancelled: 'muted',
};

const LIVE = ['trialing', 'active', 'past_due'];

export interface SubscriptionView {
  state: SubscriptionState;
  /** In search and bookable (as far as the subscription goes). */
  goodStanding: boolean;
  /** Calendar days left in the free period (Bucharest), never below 0; null outside it. */
  daysLeft: number | null;
  /** Length of the free period in days (90 normally). */
  trialDays: number | null;
  /** "Activează": no Stripe subscription runs. */
  canCheckout: boolean;
  /** "Gestionează": the shop has a Stripe customer (card, receipts, cancelling). */
  canManage: boolean;
}

export function subscriptionView(sub: SubscriptionRow, now: Date = new Date()): SubscriptionView {
  const live = LIVE.includes(sub.stripe_status ?? '');
  const trialEnd = sub.trial_ends_at ? new Date(sub.trial_ends_at) : null;
  const trialRunning = trialEnd !== null && trialEnd.getTime() > now.getTime();

  let state: SubscriptionState;
  switch (sub.status) {
    case 'trial':
      state = sub.stripe_status === 'trialing' ? 'trial_card' : trialRunning ? 'trial' : 'inactive';
      break;
    case 'active':
      state = sub.cancel_at_period_end ? 'ending' : 'active';
      break;
    case 'past_due':
      state = 'past_due';
      break;
    case 'cancelled':
      state = 'cancelled';
      break;
    default:
      state = 'inactive';
  }

  const inTrial = state === 'trial' || state === 'trial_card';
  const trialDays =
    trialEnd && sub.created_at ? Math.max(1, Math.round((trialEnd.getTime() - new Date(sub.created_at).getTime()) / 86_400_000)) : null;

  return {
    state,
    goodStanding: state !== 'inactive' && state !== 'cancelled',
    daysLeft: inTrial && trialEnd ? Math.max(0, daysFromToday(ymdInBucharest(trialEnd), now)) : null,
    trialDays: inTrial ? trialDays : null,
    canCheckout: !live,
    canManage: sub.stripe_customer_id !== null,
  };
}

/** What the shop pays a month: its price plus its colleagues (same as subscription_monthly_ron). */
export function monthlyTotal(sub: Pick<SubscriptionRow, 'price_ron' | 'seat_price_ron' | 'seats'>): number {
  return Math.round((Number(sub.price_ron) + Number(sub.seats) * Number(sub.seat_price_ron)) * 100) / 100;
}

/** The free period shown on Panou: a warning in its last 7 days while no card is given. */
export function trialWarningDays(
  sub: { status: string; trial_ends_at: string | null; card_given: boolean } | undefined,
  now: Date = new Date(),
): number | null {
  if (!sub || sub.status !== 'trial' || sub.card_given || !sub.trial_ends_at) return null;
  const end = new Date(sub.trial_ends_at);
  if (end.getTime() <= now.getTime()) return null;
  const days = daysFromToday(ymdInBucharest(end), now);
  return days <= 7 ? Math.max(0, days) : null;
}

/** "Primul coleg cu cont … e inclus" / "Primii 2 colegi … sunt incluși"; empty when none is included. */
export function includedColleagues(lang: Lang, freeSeats: number): string {
  if (!(freeSeats > 0)) return '';
  return freeSeats === 1 ? translate(lang, 'seats.included.one') : translate(lang, 'seats.included.many', { n: freeSeats });
}
