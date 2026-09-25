// report-checkout — "Plătește 29 lei" on the report preview (FR §3.6b, P16e, ARCHITECTURE §12):
// answers the address of a Stripe Checkout page for one report.
//
// 1. Checks the caller's access token; begin_history_report (SQL, service role) makes the
//    `pending_payment` row for the caller's own car — clients only, never for a car without
//    finished jobs, at the price in platform_settings. The same request id gives the same report.
// 2. Opens a one-off Checkout (card, RON) for that report; its id travels in the metadata.
// 3. Records the session on the report.
// Nothing here marks the report paid: only stripe-webhook does, after Stripe confirms the payment.
// Answers { url, report_id } — or { report_id, status } when that report is already paid — or
// { error: code }.
import { AdminError, adminApi } from '../_shared/admin.ts';
import { linkBase } from '../_shared/app.ts';
import { appUrlFromEnv, stripeConfigFromEnv } from '../_shared/env.ts';
import { bearerToken, corsHeaders, json } from '../_shared/http.ts';
import { reportCarName } from '../_shared/report.ts';
import { StripeError, stripeApi, stripeLocale } from '../_shared/stripe.ts';
import { reportError } from '../_shared/monitor.ts';

/** Refusals the app translates (src/data/reports.ts). */
const KNOWN_CODES = new Set(['not_allowed', 'account_suspended', 'car_not_found', 'booking_not_found', 'no_jobs', 'nothing_to_pay']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);
/** Where "Înapoi" on Stripe's page leads: the preview the client came from. */
const PREVIEW_PATH = /^\/c\/(garaj|programari)\/[0-9a-f-]{36}\/raport$/i;

interface Begun {
  id: string;
  code: string;
  status: string;
  price: number;
  lang: string;
  car: { make?: string; model?: string; plate?: string };
  car_id: string | null;
  display_id: string;
  email: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const api = adminApi();
    const user = await api.userFromToken(bearerToken(req));
    if (!user) return json({ error: 'not_signed_in' }, 401);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const requestId = uuidOrNull(body.request_id);
    if (!requestId) return json({ error: 'request_id_required' }, 400);
    const carId = uuidOrNull(body.car_id);
    const bookingId = carId ? null : uuidOrNull(body.booking_id);
    const lang = body.lang === 'en' ? 'en' : 'ro';

    const config = stripeConfigFromEnv();
    if (!config.secretKey) return json({ error: 'payments_unavailable' }, 503);

    let report: Begun;
    try {
      report = (await api.rpc('begin_history_report', {
        p_user_id: user.id,
        p_car_id: carId,
        p_booking_id: bookingId,
        p_lang: lang,
        p_request_id: requestId,
      })) as Begun;
    } catch (e) {
      if (e instanceof AdminError && KNOWN_CODES.has(e.message)) return json({ error: e.message }, 409);
      throw e;
    }
    if (report.status !== 'pending_payment') return json({ report_id: report.id, status: report.status });

    const amount = Math.round(Number(report.price) * 100);
    const base = linkBase(req.headers.get('origin'), appUrlFromEnv());
    const back = typeof body.return_path === 'string' && PREVIEW_PATH.test(body.return_path) ? body.return_path : '/c/cont/rapoarte';
    const car = [reportCarName(report.lang === 'en' ? 'en' : 'ro', report.car), report.car.plate].filter(Boolean).join(' · ');
    const title = report.lang === 'en' ? 'Service history report' : 'Raport istoric service';
    const metadata = { kind: 'history_report', report_id: report.id, code: report.code, account: report.display_id };

    const stripe = stripeApi(config);
    const session = await stripe.post(
      'checkout/sessions',
      {
        mode: 'payment',
        line_items: [
          {
            price_data: { currency: 'ron', unit_amount: amount, product_data: { name: `${title} · ${car}` } },
            quantity: 1,
          },
        ],
        customer_email: report.email ?? undefined,
        client_reference_id: report.id,
        locale: stripeLocale(report.lang),
        success_url: `${base}/c/cont/rapoarte?plata=ok&raport=${report.id}`,
        cancel_url: `${base}${back}?plata=anulata`,
        metadata,
        payment_intent_data: { metadata, description: `${title} ${report.code}` },
      },
      `report-checkout-${requestId}`,
    );
    if (typeof session.url !== 'string' || typeof session.id !== 'string') throw new Error('checkout session without url');
    await api.rpc('set_history_report_session', { p_report_id: report.id, p_session_id: session.id });
    return json({ url: session.url, report_id: report.id });
  } catch (e) {
    await reportError('report-checkout', e);
    return json({ error: e instanceof StripeError && e.status === 0 ? 'payments_unavailable' : 'unknown' }, 500);
  }
});
