// invite-staff — emails a staff invitation (FR §4.6, ARCHITECTURE §2 shop_staff, §11).
//
// The app first creates the invitation with the RPC invite_staff (the owner's browser makes the
// token; the database keeps only its hash), then calls this with the same token:
// 1. Checks the caller's access token with the Auth server.
// 2. Finds the pending invitation by the token's hash and checks the caller owns that shop, so
//    only whoever created an invitation can have it mailed, and only to the invited address.
// 3. Once per link (invite_emailed_hash), the email goes through Resend, with a link to the app
//    the owner is using when that is one of ours (app.ts).
// Answers { sent: true } or { sent: false, reason }. The app always shows the link as well, so
// an email that does not arrive never blocks an invitation.
import { adminApi } from '../_shared/admin.ts';
import { linkBase } from '../_shared/app.ts';
import { staffInviteEmail } from '../_shared/emails.ts';
import { bearerToken, corsHeaders, json } from '../_shared/http.ts';
import { appUrlFromEnv, emailConfigFromEnv } from '../_shared/env.ts';
import { sendEmail } from '../_shared/resend.ts';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface Invite {
  id: string;
  shop_id: string;
  invited_email: string;
  invited_at: string;
  accepted_at: string | null;
}

interface ShopRow {
  owner_id: string;
  name: string;
  city: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const api = adminApi();
    const user = await api.userFromToken(bearerToken(req));
    if (!user) return json({ error: 'not_signed_in' }, 401);

    const body = (await req.json().catch(() => ({}))) as { token?: unknown; lang?: unknown; origin?: unknown };
    const token = typeof body.token === 'string' ? body.token : '';
    if (!/^[0-9a-f]{64}$/.test(token)) return json({ error: 'invite_invalid' }, 400);
    const lang = body.lang === 'en' ? 'en' : 'ro';

    const hash = await sha256Hex(token);
    const [invite] = (await api.select(
      `shop_staff?invite_token_hash=eq.${hash}&accepted_at=is.null&select=id,shop_id,invited_email,invited_at,accepted_at`,
    )) as unknown as Invite[];
    // Only a fresh invitation: an old link cannot be used to send emails later.
    if (!invite || Date.parse(invite.invited_at) < Date.now() - 60 * 60 * 1000) {
      return json({ error: 'invite_invalid' }, 404);
    }
    const [shop] = (await api.select(`shops?id=eq.${invite.shop_id}&select=owner_id,name,city`)) as unknown as ShopRow[];
    if (!shop || shop.owner_id !== user.id) return json({ error: 'not_allowed' }, 403);

    const email = emailConfigFromEnv();
    if (!email.apiKey) return json({ sent: false, reason: 'not_configured' });

    // Claim the send: each link is mailed once (a retry of the same request sends nothing more).
    const claimed = await api.updateReturning(
      `shop_staff?id=eq.${invite.id}&invite_token_hash=eq.${hash}&or=(invite_emailed_hash.is.null,invite_emailed_hash.neq.${hash})&select=id`,
      { invite_emailed_hash: hash, invite_emailed_at: new Date().toISOString() },
    );
    if (claimed.length === 0) return json({ sent: false, reason: 'already_sent' });

    const [owner] = (await api.select(`profiles?id=eq.${user.id}&select=name`)) as unknown as { name: string | null }[];
    const base = linkBase(typeof body.origin === 'string' ? body.origin : null, appUrlFromEnv());
    const content = staffInviteEmail(lang, {
      shop: shop.name,
      city: shop.city,
      inviter: owner?.name ?? '',
      email: invite.invited_email,
      url: `${base}/invitatie/${token}`,
    });
    const result = await sendEmail(
      {
        to: invite.invited_email,
        ...content,
        replyTo: user.email,
        idempotencyKey: `invite-${hash.slice(0, 40)}`,
      },
      email,
    );
    if (result.outcome !== 'sent') {
      console.error('invite-staff: email not sent', result.error);
      // Let the owner try again right away.
      await api.update(`shop_staff?id=eq.${invite.id}&invite_emailed_hash=eq.${hash}`, {
        invite_emailed_hash: null,
        invite_emailed_at: null,
      });
      return json({ sent: false, reason: 'failed' });
    }
    return json({ sent: true });
  } catch (e) {
    console.error('invite-staff failed', e instanceof Error ? e.message : e);
    return json({ error: 'unknown' }, 500);
  }
});
