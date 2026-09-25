// delete-account — "Șterge contul" (FR §2, ARCHITECTURE §11).
//
// 1. Checks the caller's access token with the Auth server.
// 2. prepare_account_deletion (SQL, service role): refuses while bookings are active, strips the
//    person's name and phone from what shops keep, deletes their own data, and answers:
//      'delete'    → the login is deleted; the database cascades the rest;
//      'anonymize' → a shop with bookings or invoices keeps its records (required by law): the
//                    login is closed for good — banned, email and password replaced.
// 3. A shop owner's running Stripe subscription is cancelled first (T14), so the card is never
//    charged again; if Stripe cannot be reached nothing is deleted and the app can try again.
// Safe to retry: both steps give the same result the second time.
import { cancelStripeSubscription, removeLogin } from '../_shared/accountDeletion.ts';
import { AdminError, adminApi } from '../_shared/admin.ts';
import { bearerToken, corsHeaders, json } from '../_shared/http.ts';

/** Refusals the app translates (src/data/account.ts). */
const KNOWN_CODES = new Set(['not_allowed', 'account_has_active_bookings', 'shop_has_active_bookings']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const api = adminApi();
    const user = await api.userFromToken(bearerToken(req));
    if (!user) return json({ error: 'not_signed_in' }, 401);

    let mode: unknown;
    try {
      mode = await api.rpc('prepare_account_deletion', { p_user_id: user.id });
    } catch (e) {
      if (e instanceof AdminError && KNOWN_CODES.has(e.message)) return json({ error: e.message }, 409);
      throw e;
    }

    try {
      await cancelStripeSubscription(api, user.id);
    } catch (e) {
      console.error('delete-account: Stripe subscription not cancelled', e instanceof Error ? e.message : e);
      return json({ error: 'subscription_cancel_failed' }, 502);
    }

    await removeLogin(api, user.id, mode);
    return json({ ok: true });
  } catch (e) {
    console.error('delete-account failed', e instanceof Error ? e.message : e);
    return json({ error: 'unknown' }, 500);
  }
});
