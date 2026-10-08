import { call } from './rpc';

/** What a shop pays, as set now in Setări platformă (T18: the landing page shows it). */
export interface PublicPricing {
  subscriptionRon: number;
  seatRon: number;
  /** Colleagues with an account included in the subscription. */
  freeSeats: number;
  trialDays: number;
  /** The launch price while places are open (in the city asked, or somewhere); never how many. */
  launchRon: number | null;
  /** Discount in percent when paying for 3, 6 or 12 months at once (0 when not offered). */
  periodDiscounts: { 3: number; 6: number; 12: number };
}

/** Anyone may ask, signed out too; with a city, whether its launch places are still open. */
export async function fetchPublicPricing(city?: string): Promise<PublicPricing> {
  const data = (await call('public_pricing', (city?.trim() ? { p_city: city.trim() } : {}) as never)) as Record<string, unknown> | null;
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
  const pricing = {
    subscriptionRon: num(data?.subscription_price_ron),
    seatRon: num(data?.seat_price_ron),
    freeSeats: num(data?.free_seats),
    trialDays: num(data?.trial_days),
  };
  if (!Object.values(pricing).every(Number.isFinite)) throw new Error('public_pricing: unexpected answer');
  const launch = data?.launch_price_ron == null ? null : num(data.launch_price_ron);
  const periods = (data?.period_discounts ?? {}) as Record<string, unknown>;
  const discount = (m: number) => num(periods[String(m)]) || 0;
  return {
    ...pricing,
    launchRon: launch !== null && Number.isFinite(launch) && launch > 0 ? launch : null,
    periodDiscounts: { 3: discount(3), 6: discount(6), 12: discount(12) },
  };
}
