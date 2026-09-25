import { call } from './rpc';

/** What a shop pays, as set now in Setări platformă (T18: the landing page shows it). */
export interface PublicPricing {
  subscriptionRon: number;
  seatRon: number;
  /** Colleagues with an account included in the subscription. */
  freeSeats: number;
  trialDays: number;
  /** The launch price while places are left (null otherwise), and for how many shops in all. */
  launchRon: number | null;
  launchShops: number;
}

/** Anyone may ask, signed out too. */
export async function fetchPublicPricing(): Promise<PublicPricing> {
  const data = (await call('public_pricing', undefined as never)) as Record<string, unknown> | null;
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
  const pricing = {
    subscriptionRon: num(data?.subscription_price_ron),
    seatRon: num(data?.seat_price_ron),
    freeSeats: num(data?.free_seats),
    trialDays: num(data?.trial_days),
  };
  if (!Object.values(pricing).every(Number.isFinite)) throw new Error('public_pricing: unexpected answer');
  const launch = data?.launch_price_ron == null ? null : num(data.launch_price_ron);
  return { ...pricing, launchRon: launch !== null && Number.isFinite(launch) && launch > 0 ? launch : null, launchShops: num(data?.launch_shops) || 0 };
}
