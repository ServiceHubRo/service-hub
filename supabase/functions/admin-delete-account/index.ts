// admin-delete-account — the admin deletes a client's account or a shop (its owner's account)
// from the admin screens (FR §5.2, §5.3; ARCHITECTURE §11).
//
// 1. Checks the caller's access token with the Auth server.
// 2. admin_account_deletion (SQL, service role): the caller must be an admin; the same rules as
//    "Șterge contul" (refused while bookings are active; a shop with records is anonymized), and
//    the audit log row, in one transaction.
// 3. Stops the owner's running Stripe subscription, then deletes or closes the login
//    (_shared/accountDeletion.ts). Safe to retry: an account already gone answers ok.
// Body: { user_id }. Answers { ok: true, mode } or { error }.
import { cancelStripeSubscription, removeLogin } from '../_shared/accountDeletion.ts';
import { AdminError, adminApi } from '../_shared/admin.ts';
import { bearerToken, corsHeaders, json } from '../_shared/http.ts';
import { reportError } from '../_shared/monitor.ts';

/** Refusals the app translates (src/data/admin.ts). */
const KNOWN_CODES = new Set(['not_allowed', 'account_has_active_bookings', 'shop_has_active_bookings']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const api = adminApi();
    const caller = await api.userFromToken(bearerToken(req));
    if (!caller) return json({ error: 'not_signed_in' }, 401);

    let body: { user_id?: unknown };
    try {
      body = (await req.json()) as { user_id?: unknown };
    } catch {
      return json({ error: 'bad_request' }, 400);
    }
    const userId = typeof body.user_id === 'string' && UUID.test(body.user_id) ? body.user_id : null;
    if (!userId) return json({ error: 'bad_request' }, 400);

    let mode: unknown;
    try {
      mode = await api.rpc('admin_account_deletion', { p_admin_id: caller.id, p_user_id: userId });
    } catch (e) {
      // Deleted by an earlier try whose answer was lost.
      if (e instanceof AdminError && e.message === 'not_found') return json({ ok: true, mode: 'delete' });
      if (e instanceof AdminError && KNOWN_CODES.has(e.message)) return json({ error: e.message }, 409);
      throw e;
    }

    try {
      await cancelStripeSubscription(api, userId);
    } catch (e) {
      await reportError('admin-delete-account', e, { tags: { step: 'stripe_cancel' } });
      return json({ error: 'subscription_cancel_failed' }, 502);
    }

    await removeLogin(api, userId, mode);
    return json({ ok: true, mode });
  } catch (e) {
    await reportError('admin-delete-account', e);
    return json({ error: 'unknown' }, 500);
  }
});
