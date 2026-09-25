// stripe-portal — "Gestionează abonamentul" (FR §4.7, ARCHITECTURE §12): answers the address of
// Stripe's customer portal, where the shop's owner changes the card, sees Stripe's invoices and
// cancels (at the end of the paid month). Owner only; the shop needs a Stripe customer (made by
// the first checkout). Whatever is changed there reaches us through stripe-webhook.
// Answers { url } or { error: code }.
import { AdminError, adminApi } from '../_shared/admin.ts';
import { linkBase } from '../_shared/app.ts';
import { appUrlFromEnv, stripeConfigFromEnv } from '../_shared/env.ts';
import { bearerToken, corsHeaders, json } from '../_shared/http.ts';
import { stripeApi, stripeLocale } from '../_shared/stripe.ts';

const KNOWN_CODES = new Set(['not_allowed', 'account_suspended']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const api = adminApi();
    const user = await api.userFromToken(bearerToken(req));
    if (!user) return json({ error: 'not_signed_in' }, 401);

    let info: { lang: string; stripe_customer_id: string | null };
    try {
      info = (await api.rpc('subscription_checkout_info', { p_user_id: user.id })) as typeof info;
    } catch (e) {
      if (e instanceof AdminError && KNOWN_CODES.has(e.message)) return json({ error: e.message }, 409);
      throw e;
    }

    const config = stripeConfigFromEnv();
    if (!config.secretKey) return json({ error: 'payments_unavailable' }, 503);
    if (!info.stripe_customer_id) return json({ error: 'no_customer' }, 409);

    const session = await stripeApi(config).post('billing_portal/sessions', {
      customer: info.stripe_customer_id,
      return_url: `${linkBase(req.headers.get('origin'), appUrlFromEnv())}/s/cont/abonament`,
      locale: stripeLocale(info.lang),
    });
    if (typeof session.url !== 'string') throw new Error('portal session without url');
    return json({ url: session.url });
  } catch (e) {
    console.error('stripe-portal failed', e instanceof Error ? e.message : e);
    return json({ error: 'unknown' }, 500);
  }
});
