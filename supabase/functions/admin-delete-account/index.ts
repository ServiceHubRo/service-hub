// admin-delete-account — the admin deletes a client's account or a shop (its owner's account)
// from the admin screens (FR §5.2, §5.3; ARCHITECTURE §11).
//
// 1. Checks the caller's access token with the Auth server.
// 2. admin_account_deletion (SQL, service role): the caller must be an active admin whose session
//    still exists (A6 H1: not_signed_in otherwise), a reason is required (A6 M5); the same rules as
//    "Șterge contul" (refused while bookings are active; a shop with records is anonymized), and
//    the audit log row with the reason and the session, in one transaction. A refused admin call is
//    recorded in the security log (Platformă → Securitate).
// 3. Stops the owner's running Stripe subscription, then deletes or closes the login
//    (_shared/accountDeletion.ts). Safe to retry: an account already gone answers ok.
// Body: { user_id, reason }. Answers { ok: true, mode } or { error }.
import { cancelStripeSubscription, removeLogin } from '../_shared/accountDeletion.ts';
import { AdminError, adminApi, tokenAal, tokenSession } from '../_shared/admin.ts';
import { bearerToken, corsHeaders, json } from '../_shared/http.ts';
import { reportError } from '../_shared/monitor.ts';

/** Refusals the app translates (src/data/admin.ts). */
// company_last_admin (A7): the only administrator of a company with other members stays until the
// administration goes to another member (FLEET_PLAN R7, now checked in prepare_account_deletion).
const KNOWN_CODES = new Set(['not_allowed', 'account_has_active_bookings', 'shop_has_active_bookings', 'reason_required', 'reason_too_long', 'company_last_admin']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const api = adminApi();
    const token = bearerToken(req);
    const caller = await api.userFromToken(token);
    if (!caller) return json({ error: 'not_signed_in' }, 401);
    // Only admins call this, and only after the second step of sign-in (T25).
    if (tokenAal(token) !== 'aal2') return json({ error: 'mfa_required' }, 403);

    let body: { user_id?: unknown; reason?: unknown };
    try {
      body = (await req.json()) as { user_id?: unknown; reason?: unknown };
    } catch {
      return json({ error: 'bad_request' }, 400);
    }
    const userId = typeof body.user_id === 'string' && UUID.test(body.user_id) ? body.user_id : null;
    if (!userId) return json({ error: 'bad_request' }, 400);
    const reason = typeof body.reason === 'string' ? body.reason : null;

    let mode: unknown;
    try {
      mode = await api.rpc('admin_account_deletion', {
        p_admin_id: caller.id,
        p_user_id: userId,
        p_reason: reason,
        p_session: tokenSession(token),
      });
    } catch (e) {
      // Deleted by an earlier try whose answer was lost.
      if (e instanceof AdminError && e.message === 'not_found') return json({ ok: true, mode: 'delete' });
      // Not an active admin, or its session is gone (A6): recorded, then refused.
      if (e instanceof AdminError && (e.message === 'not_allowed' || e.message === 'not_signed_in')) {
        await api
          .rpc('security_report', {
            p_user: caller.id,
            p_kind: e.message === 'not_signed_in' ? 'admin_session_invalid' : 'admin_denied',
            p_severity: 'high',
            p_detail: { via: 'admin-delete-account', target: userId },
          })
          .catch((err) => reportError('admin-delete-account', err, { tags: { step: 'security_report' } }));
        return e.message === 'not_signed_in' ? json({ error: 'not_signed_in' }, 401) : json({ error: 'not_allowed' }, 403);
      }
      if (e instanceof AdminError && KNOWN_CODES.has(e.message)) {
        return json({ error: e.message }, e.message.startsWith('reason') ? 422 : 409);
      }
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
