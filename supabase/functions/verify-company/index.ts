// verify-company — the company behind a shop's CUI, from ANAF's public register (T25).
//
// 1. Checks the caller's token with the Auth server. Without a body: the caller's own shop (the
//    owner, after saving Date de facturare). With { shop_id }: an admin, after the second step of
//    sign-in (company_check_target checks both).
// 2. Asks ANAF about the CUI saved in shop_billing (never one from the request) and records the
//    answer: the official name (and whether it matches the legal name typed), active, inactive or
//    deregistered, VAT payer (record_company_check). A CUI or legal name changed meanwhile is not
//    written over.
// 3. ANAF slow or down: nothing changes, the answer is { unavailable: true }; the app says so.
// Answers the billing row's ANAF fields. A check of the same CUI within the last minute answers
// what is stored without asking ANAF again.
import { AdminError, adminApi, tokenAal } from '../_shared/admin.ts';
import { ANAF_URL, anafRequest, cuiDigits, readAnafAnswer } from '../_shared/anaf.ts';
import { bearerToken, corsHeaders, json } from '../_shared/http.ts';
import { reportError } from '../_shared/monitor.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN = new Set(['not_allowed', 'no_vat_id']);

interface Target {
  shop_id: string;
  vat_id: string;
  legal_name: string | null;
  anaf_cui: string | null;
  anaf_checked_at: string | null;
}

const FIELDS = 'anaf_cui,anaf_status,anaf_name,anaf_address,anaf_vat_payer,anaf_name_match,anaf_checked_at';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const api = adminApi();
    const token = bearerToken(req);
    const user = await api.userFromToken(token);
    if (!user) return json({ error: 'not_signed_in' }, 401);

    let shopId: string | null = null;
    try {
      const body = (await req.json()) as { shop_id?: unknown } | null;
      if (body && typeof body.shop_id === 'string' && UUID.test(body.shop_id)) shopId = body.shop_id;
    } catch {
      // no body: the caller's own shop
    }

    let target: Target;
    try {
      target = (await api.rpc('company_check_target', {
        p_user_id: user.id,
        p_shop_id: shopId,
        p_aal: tokenAal(token),
      })) as Target;
    } catch (e) {
      if (e instanceof AdminError && KNOWN.has(e.message)) return json({ error: e.message }, e.message === 'not_allowed' ? 403 : 409);
      throw e;
    }

    const stored = async () =>
      (await api.select(`shop_billing?shop_id=eq.${target.shop_id}&select=${FIELDS}`))[0] ?? {};
    const recent =
      target.anaf_cui === target.vat_id &&
      target.anaf_checked_at !== null &&
      Date.now() - new Date(target.anaf_checked_at).getTime() < 60_000;
    if (recent) return json(await stored());

    const cui = cuiDigits(target.vat_id);
    if (cui === null) return json({ error: 'no_vat_id' }, 409);

    let answer: unknown;
    try {
      const res = await fetch(Deno.env.get('ANAF_API_URL') || ANAF_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(anafRequest(cui)),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`anaf ${res.status}`);
      answer = await res.json();
    } catch (e) {
      console.warn('verify-company: ANAF unreachable', e);
      return json({ unavailable: true });
    }
    const check = readAnafAnswer(answer, cui, target.legal_name);
    if (!check) {
      console.warn('verify-company: an ANAF answer we do not understand');
      return json({ unavailable: true });
    }
    await api.rpc('record_company_check', { p_shop_id: target.shop_id, p_cui: target.vat_id, p_result: check });
    return json(await stored());
  } catch (e) {
    await reportError('verify-company', e);
    return json({ error: 'internal' }, 500);
  }
});
