import { call } from './rpc';

/** What a shop pays, as set now in Setări platformă (T18: the landing page shows it). */
export interface PublicPricing {
  subscriptionRon: number;
  seatRon: number;
  trialDays: number;
}

/** Anyone may ask, signed out too. */
export async function fetchPublicPricing(): Promise<PublicPricing> {
  const data = (await call('public_pricing', undefined as never)) as Record<string, unknown> | null;
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
  const pricing = {
    subscriptionRon: num(data?.subscription_price_ron),
    seatRon: num(data?.seat_price_ron),
    trialDays: num(data?.trial_days),
  };
  if (!Object.values(pricing).every(Number.isFinite)) throw new Error('public_pricing: unexpected answer');
  return pricing;
}
