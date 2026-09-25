// stripe-webhook — the only way a payment changes a subscription (ARCHITECTURE §12, P12b).
//
// 1. Checks the Stripe-Signature header against the raw body with STRIPE_WEBHOOK_SECRET
//    (a forged or replayed request is refused with 400).
// 2. stripe_event_begin records the event; one already handled is answered 200 and skipped.
// 3. Reads the subscription as Stripe has it now (so events arriving out of order change
//    nothing) and hands it to sync_stripe_subscription; paid and failed invoices are recorded
//    first (record_stripe_invoice / record_payment_failed), so a payment reactivates at once.
// 4. stripe_event_done. Any failure answers 500 and Stripe delivers the event again later.
//
// History reports (T15): a paid one-off Checkout with metadata.kind = history_report marks that
// report paid (mark_history_report_paid) and makes its PDF at once (reportGenerate.ts). If the
// PDF fails, the event is answered 500 and Stripe's next delivery tries again; the client can
// also retry from Rapoartele mele (generate-report).
//
// Colleagues (paid staff seats): when a subscription starts, the colleagues' quantity is checked
// against the shop's count now (someone may have joined while Checkout was open) and set if it
// differs (_shared/seats.ts); what Stripe charges is recorded as billed_seats.
//
// Events to send (Stripe → Developers → Webhooks): checkout.session.completed,
// customer.subscription.created, customer.subscription.updated, customer.subscription.deleted,
// invoice.paid, invoice.payment_failed.
//
// Any API version on the endpoint works: only the event's type and the object's id are taken from
// the event; the Checkout session, subscription or invoice is read back from the API, which
// answers in STRIPE_API_VERSION (the event's own copy is used only if Stripe no longer has it).
import { adminApi } from '../_shared/admin.ts';
import { appUrlFromEnv, stripeConfigFromEnv } from '../_shared/env.ts';
import { json } from '../_shared/http.ts';
import { generateReport } from '../_shared/reportGenerate.ts';
import { seatPrice, syncSeats, type SeatInfo } from '../_shared/seats.ts';
import {
  failedInvoice,
  invoiceSubscriptionId,
  paidInvoice,
  StripeError,
  stripeApi,
  subscriptionState,
  verifyStripeSignature,
  type StripeApi,
} from '../_shared/stripe.ts';

type Api = ReturnType<typeof adminApi>;
type Obj = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);
const idOf = (v: unknown): string | null =>
  typeof v === 'string' ? v || null : v && typeof v === 'object' ? ((v as { id?: string }).id ?? null) : null;

/** The subscription as Stripe has it now; the event's own copy when Stripe no longer has it. */
async function latest(stripe: StripeApi, id: string, fallback?: Obj): Promise<Obj | null> {
  try {
    return await stripe.get(`subscriptions/${id}`);
  } catch (e) {
    if (e instanceof StripeError && e.status === 404) return fallback ?? null;
    throw e;
  }
}

async function sync(api: Api, stripe: StripeApi, id: string | null, shopHint: unknown, fallback?: Obj): Promise<string | null> {
  if (!id) return null;
  const sub = await latest(stripe, id, fallback);
  if (!sub) return null;
  const state = subscriptionState(sub);
  if (!state.customer) return null;
  const shop = uuidOrNull(shopHint) ?? uuidOrNull((sub.metadata as Obj | undefined)?.shop_id);
  await api.rpc('sync_stripe_subscription', { p_customer: state.customer, p_shop_id: shop, p_sub: state });
  return state.customer;
}

/** A subscription just started: Stripe charges for the shop's colleagues as they are now. */
async function seatsAtStart(api: Api, stripe: StripeApi, seatPriceId: string | undefined, customer: string | null, eventId: string) {
  if (!customer || !seatPriceId) return;
  const info = (await api.rpc('stripe_seat_info', { p_customer: customer })) as SeatInfo | null;
  if (!info) return;
  const r = await syncSeats(stripe, await seatPrice(stripe, seatPriceId), info, `webhook-${eventId}`);
  if (r.billed !== null) await api.rpc('set_billed_seats', { p_shop_id: info.shop_id, p_seats: r.billed });
}

/**
 * The event's Checkout session or invoice as the API has it now, in STRIPE_API_VERSION, whatever
 * version the webhook endpoint renders events in. Subscriptions are read back by sync().
 */
async function current(stripe: StripeApi, type: string, object: Obj): Promise<Obj> {
  const id = idOf(object.id);
  const path = type.startsWith('checkout.session.') ? 'checkout/sessions' : type.startsWith('invoice.') ? 'invoices' : null;
  if (!id || !path) return object;
  try {
    return await stripe.get(`${path}/${id}`);
  } catch (e) {
    if (e instanceof StripeError && e.status === 404) return object;
    throw e;
  }
}

/** A paid Checkout for a history report: paid, then its PDF. */
async function reportPaid(api: Api, session: Obj): Promise<void> {
  const metadata = (session.metadata ?? {}) as Obj;
  const report = uuidOrNull(metadata.report_id);
  if (!report || session.payment_status !== 'paid') return;
  const row = (await api.rpc('mark_history_report_paid', {
    p_report_id: report,
    p_session_id: idOf(session.id),
    p_amount: typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
    p_paid_at: typeof session.created === 'number' ? new Date(session.created * 1000).toISOString() : null,
  })) as Obj | null;
  if (row && row.status === 'paid') await generateReport(api, row, appUrlFromEnv());
}

async function handle(api: Api, stripe: StripeApi, seatPriceId: string | undefined, type: string, sent: Obj, eventId: string): Promise<void> {
  const object = await current(stripe, type, sent);
  switch (type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      if (object.mode === 'subscription') {
        const customer = await sync(api, stripe, idOf(object.subscription), object.client_reference_id);
        await seatsAtStart(api, stripe, seatPriceId, customer, eventId);
      } else if (object.mode === 'payment' && (object.metadata as Obj | undefined)?.kind === 'history_report') await reportPaid(api, object);
      return;
    case 'customer.subscription.created':
      await seatsAtStart(api, stripe, seatPriceId, await sync(api, stripe, idOf(object.id), null, object), eventId);
      return;
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      await sync(api, stripe, idOf(object.id), null, object);
      return;
    case 'invoice.paid': {
      const customer = idOf(object.customer);
      if (customer) await api.rpc('record_stripe_invoice', { p_customer: customer, p_invoice: paidInvoice(object) });
      await sync(api, stripe, invoiceSubscriptionId(object), null);
      return;
    }
    case 'invoice.payment_failed': {
      const customer = idOf(object.customer);
      if (customer) await api.rpc('record_payment_failed', { p_customer: customer, p_invoice: failedInvoice(object) });
      await sync(api, stripe, invoiceSubscriptionId(object), null);
      return;
    }
    default:
      return;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const config = stripeConfigFromEnv();
  if (!config.webhookSecret || !config.secretKey) return json({ error: 'payments_unavailable' }, 503);

  const payload = await req.text();
  if (!(await verifyStripeSignature(payload, req.headers.get('stripe-signature'), config.webhookSecret))) {
    return json({ error: 'bad_signature' }, 400);
  }

  let event: { id?: string; type?: string; data?: { object?: Obj } };
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: 'bad_payload' }, 400);
  }
  if (typeof event.id !== 'string' || typeof event.type !== 'string') return json({ error: 'bad_payload' }, 400);

  try {
    const api = adminApi();
    const fresh = await api.rpc('stripe_event_begin', { p_id: event.id, p_type: event.type, p_payload: event });
    if (fresh !== true) return json({ received: true, duplicate: true });
    await handle(api, stripeApi(config), config.seatPriceId, event.type, event.data?.object ?? {}, event.id);
    await api.rpc('stripe_event_done', { p_id: event.id });
    return json({ received: true });
  } catch (e) {
    console.error('stripe-webhook failed', event.type, e instanceof Error ? e.message : e);
    return json({ error: 'server_error' }, 500);
  }
});
