// stripe-checkout — "Activează abonamentul" (FR §4.7, ARCHITECTURE §12): answers the address of a
// Stripe Checkout page where the shop's owner pays the monthly subscription by card.
//
// 1. Checks the caller's access token; subscription_checkout_info (SQL, service role) answers
//    only for the owner of a shop.
// 2. Refuses when a Stripe subscription already runs (the portal manages it), when the billing
//    data the invoice needs is missing, or when the shop has nothing to pay.
// 3. Makes the shop's Stripe customer once (recorded in subscriptions.stripe_customer_id).
// 4. Opens Checkout at the shop's own price (subscriptions.price_ron: STRIPE_PRICE_ID when it is
//    the same amount, else the same product at the shop's amount). Inside the free period the
//    card is only saved: the first charge is at the end of the free period. The colleagues with an
//    account are a second line, "Cont angajat" × seats (STRIPE_SEAT_PRICE_ID, the shop's price per
//    colleague); later changes reach Stripe through the outbox (seats_changed, _shared/seats.ts).
// The request id of the tap is the idempotency key, so a repeated tap gets the same page.
// Nothing here changes the subscription's status: only the webhook does (stripe-webhook).
// Answers { url } or { error: code }.
import { AdminError, adminApi } from '../_shared/admin.ts';
import { linkBase } from '../_shared/app.ts';
import { appUrlFromEnv, stripeConfigFromEnv } from '../_shared/env.ts';
import { bearerToken, corsHeaders, json } from '../_shared/http.ts';
import { seatLineItem, seatPrice, type SeatInfo } from '../_shared/seats.ts';
import { hasLiveSubscription, StripeError, stripeApi, stripeLocale, trialEndForCheckout } from '../_shared/stripe.ts';
import { reportError } from '../_shared/monitor.ts';

/** Refusals the app translates (src/data/subscription.ts). */
const KNOWN_CODES = new Set(['not_allowed', 'account_suspended']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Info {
  shop_id: string;
  shop_name: string;
  display_id: string;
  lang: string;
  email: string | null;
  price_ron: number;
  status: string;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  stripe_status: string | null;
  billing_complete: boolean;
  legal_name: string | null;
  vat_id: string | null;
  billing_email: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const api = adminApi();
    const user = await api.userFromToken(bearerToken(req));
    if (!user) return json({ error: 'not_signed_in' }, 401);

    const body = (await req.json().catch(() => ({}))) as { request_id?: unknown };
    const requestId = typeof body.request_id === 'string' && UUID.test(body.request_id) ? body.request_id : crypto.randomUUID();

    let info: Info;
    try {
      info = (await api.rpc('subscription_checkout_info', { p_user_id: user.id })) as Info;
    } catch (e) {
      if (e instanceof AdminError && KNOWN_CODES.has(e.message)) return json({ error: e.message }, 409);
      throw e;
    }

    const config = stripeConfigFromEnv();
    if (!config.secretKey || !config.priceId) return json({ error: 'payments_unavailable' }, 503);
    if (hasLiveSubscription(info.stripe_status)) return json({ error: 'subscription_exists' }, 409);
    if (!info.billing_complete) return json({ error: 'billing_incomplete' }, 409);
    const amount = Math.round(Number(info.price_ron) * 100);
    if (!(amount > 0)) return json({ error: 'nothing_to_pay' }, 409);

    const stripe = stripeApi(config);
    const locale = stripeLocale(info.lang);
    const customerFields = {
      email: info.billing_email ?? info.email ?? undefined,
      name: info.legal_name?.trim() || info.shop_name,
      preferred_locales: [locale],
      metadata: { shop_id: info.shop_id, account: info.display_id, vat_id: info.vat_id ?? '' },
    };

    let customer = info.stripe_customer_id;
    if (!customer) {
      const created = await stripe.post('customers', customerFields, `customer-${info.shop_id}-${requestId}`);
      customer = (await api.rpc('set_stripe_customer', { p_shop_id: info.shop_id, p_customer_id: created.id })) as string;
    } else {
      // Keeps the name and address on Stripe's receipts in step with the billing data.
      await stripe.post(`customers/${customer}`, customerFields).catch((e) => console.error('stripe-checkout: customer update', e));
    }

    const seats = (await api.rpc('stripe_seat_info', { p_shop_id: info.shop_id })) as SeatInfo;
    if (seats.seats > 0 && !config.seatPriceId) return json({ error: 'payments_unavailable' }, 503);
    const seatLine = seats.seats > 0 ? seatLineItem(await seatPrice(stripe, config.seatPriceId!), seats.seat_price_ron, seats.seats) : null;

    const price = await stripe.get(`prices/${config.priceId}`);
    const samePrice = price.unit_amount === amount && String(price.currency).toLowerCase() === 'ron';
    const lineItem = samePrice
      ? { price: config.priceId, quantity: 1 }
      : {
          price_data: { currency: 'ron', product: price.product, unit_amount: amount, recurring: { interval: 'month' } },
          quantity: 1,
        };

    const base = `${linkBase(req.headers.get('origin'), appUrlFromEnv())}/s/cont/abonament`;
    const trialEnd = trialEndForCheckout(info.trial_ends_at, info.status);
    const session = await stripe.post(
      'checkout/sessions',
      {
        mode: 'subscription',
        customer,
        client_reference_id: info.shop_id,
        line_items: seatLine ? [lineItem, seatLine] : [lineItem],
        locale,
        success_url: `${base}?plata=ok`,
        cancel_url: `${base}?plata=anulata`,
        metadata: { shop_id: info.shop_id },
        subscription_data: { metadata: { shop_id: info.shop_id }, ...(trialEnd ? { trial_end: trialEnd } : {}) },
      },
      `checkout-${info.shop_id}-${requestId}`,
    );
    if (typeof session.url !== 'string') throw new Error('checkout session without url');
    return json({ url: session.url });
  } catch (e) {
    await reportError('stripe-checkout', e);
    return json({ error: e instanceof StripeError && e.status === 0 ? 'payments_unavailable' : 'unknown' }, 500);
  }
});
