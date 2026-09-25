// phone-verify-start — sends a 6-digit code by SMS to the signed-in shop account's phone
// (FR §2, ARCHITECTURE §11). The app then checks it with the RPC check_phone_code.
//
// 1. Checks the caller's access token with the Auth server.
// 2. Makes a random code; phone_verify_begin (SQL, service role) stores only its hash and applies
//    the rules: shops only, one code a minute, 5 a day per account and per number. A second tap
//    within the minute sends nothing and answers when a new code may be asked for.
// 3. Sends the SMS through SMSO. When it cannot be sent the code is forgotten
//    (phone_verify_cancel), so it neither blocks nor counts.
// Answers { status: 'sent' | 'wait', expires_at, resend_in } or { error: code }.
import { AdminError, adminApi } from '../_shared/admin.ts';
import { bearerToken, corsHeaders, json } from '../_shared/http.ts';
import { codeSms } from '../_shared/sms.ts';
import { smsConfigFromEnv } from '../_shared/env.ts';
import { sendSms, toE164 } from '../_shared/smso.ts';

/** Refusals the app translates (rpcError.*). */
const KNOWN_CODES = new Set(['not_allowed', 'phone_missing', 'phone_already_verified', 'limit_phone_codes', 'account_suspended']);

function randomCode(): string {
  // Rejection sampling: every code from 000000 to 999999 equally likely.
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < 4_294_000_000) return String(buf[0]! % 1_000_000).padStart(6, '0');
  }
}

interface Begin {
  status: 'send' | 'wait';
  id?: string;
  phone?: string;
  lang?: string;
  expires_at?: string;
  wait_seconds?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const api = adminApi();
    const user = await api.userFromToken(bearerToken(req));
    if (!user) return json({ error: 'not_signed_in' }, 401);

    const sms = smsConfigFromEnv();
    if (!sms.apiKey) return json({ error: 'sms_unavailable' }, 503);

    const code = randomCode();
    let begin: Begin;
    try {
      begin = (await api.rpc('phone_verify_begin', { p_user_id: user.id, p_code: code })) as Begin;
    } catch (e) {
      if (e instanceof AdminError && KNOWN_CODES.has(e.message)) return json({ error: e.message }, 409);
      throw e;
    }

    if (begin.status === 'wait') {
      return json({ status: 'wait', expires_at: begin.expires_at, resend_in: begin.wait_seconds ?? 60 });
    }

    if (!toE164(begin.phone)) {
      await api.rpc('phone_verify_cancel', { p_id: begin.id });
      return json({ error: 'phone_invalid' }, 409);
    }
    const sent = await sendSms(begin.phone!, codeSms(begin.lang ?? 'ro', code), sms);
    if (sent.outcome !== 'sent') {
      console.error('phone-verify-start: SMS not sent', sent.error);
      await api.rpc('phone_verify_cancel', { p_id: begin.id });
      return json({ error: 'sms_failed' }, 502);
    }
    return json({ status: 'sent', expires_at: begin.expires_at, resend_in: 60 });
  } catch (e) {
    console.error('phone-verify-start failed', e instanceof Error ? e.message : e);
    return json({ error: 'unknown' }, 500);
  }
});
