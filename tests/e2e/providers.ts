import { createHmac } from 'node:crypto';
import http from 'node:http';
import { expect } from '@playwright/test';

/**
 * Stand-ins for Resend (email), SMSO (SMS) and Stripe (T13, T14) for the browser tests. The local
 * stack's Edge Functions send to them (supabase/config.toml → [edge_runtime.secrets] points at
 * host.docker.internal:54398); the server runs once for the whole test run (global-setup.ts) and
 * the tests read what arrived through GET /_log.
 */
export const PROVIDERS_PORT = 54398;
const LOG_URL = `http://127.0.0.1:${PROVIDERS_PORT}/_log`;

export interface SentEmail {
  kind: 'email';
  to: string;
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  idempotencyKey?: string;
}

export interface SentSms {
  kind: 'sms';
  to: string;
  sender: string;
  body: string;
}

type Sent = SentEmail | SentSms;

export function startProviders(): Promise<() => Promise<void>> {
  const log: Sent[] = [];
  const seenKeys = new Set<string>();
  const stripe = stripeStandIn();
  const server = http.createServer((req, res) => {
    if ((req.url ?? '').startsWith('/stripe/')) {
      stripe(req, res);
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const reply = (status: number, data: unknown) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
      };
      const url = req.url ?? '';
      if (req.method === 'GET' && url === '/_log') return reply(200, log);
      if (req.method === 'POST' && url === '/resend/emails') {
        if (req.headers.authorization !== 'Bearer local-test-key') return reply(401, { message: 'bad key' });
        const m = JSON.parse(body) as { to: string[]; subject: string; html: string; text: string; reply_to?: string };
        const key = String(req.headers['idempotency-key'] ?? '');
        // Like Resend: the same idempotency key sends once.
        if (key && seenKeys.has(key)) return reply(200, { id: 'duplicate' });
        if (key) seenKeys.add(key);
        log.push({ kind: 'email', to: m.to[0]!, subject: m.subject, html: m.html, text: m.text, reply_to: m.reply_to, idempotencyKey: key });
        return reply(200, { id: crypto.randomUUID() });
      }
      if (req.method === 'POST' && url === '/smso/send') {
        if (req.headers['x-authorization'] !== 'local-test-key') return reply(401, { status: 401 });
        const form = new URLSearchParams(body);
        log.push({ kind: 'sms', to: form.get('to') ?? '', sender: form.get('sender') ?? '', body: form.get('body') ?? '' });
        return reply(200, { status: 200, responseToken: crypto.randomUUID(), transaction_cost: 0.05 });
      }
      reply(404, { message: 'not found' });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PROVIDERS_PORT, '0.0.0.0', () =>
      resolve(() => new Promise<void>((done) => server.close(() => done()))),
    );
  });
}

async function readLog(): Promise<Sent[]> {
  return (await (await fetch(LOG_URL)).json()) as Sent[];
}

/** Every email sent to an address so far. */
export async function emailsTo(to: string): Promise<SentEmail[]> {
  return (await readLog()).filter((m): m is SentEmail => m.kind === 'email' && m.to.toLowerCase() === to.toLowerCase());
}

/** The newest email to an address, waiting for it. */
export async function nextEmail(to: string, after = 0): Promise<SentEmail> {
  await expect.poll(async () => (await emailsTo(to)).length, { timeout: 20_000 }).toBeGreaterThan(after);
  const list = await emailsTo(to);
  return list[list.length - 1]!;
}

/** Every SMS sent to a number (`+40…`) so far. */
export async function smsTo(to: string): Promise<SentSms[]> {
  return (await readLog()).filter((m): m is SentSms => m.kind === 'sms' && m.to === to);
}

/** The newest SMS to a number, waiting for it. */
export async function nextSms(to: string, after = 0): Promise<SentSms> {
  await expect.poll(async () => (await smsTo(to)).length, { timeout: 20_000 }).toBeGreaterThan(after);
  const list = await smsTo(to);
  return list[list.length - 1]!;
}

// ------------------------------------------------------------------------------------ Stripe (T14)

/** The local stack's Edge Function secrets (supabase/config.toml). */
const STRIPE_KEY = 'sk_test_local';
const STRIPE_WEBHOOK_SECRET = 'whsec_local_test';
const FUNCTIONS_URL = `${process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'}/functions/v1`;
const PAGES = `http://127.0.0.1:${PROVIDERS_PORT}/stripe`;

type Obj = Record<string, unknown>;

/** Stripe's form encoding back into an object (`a[b][0][c]=…`). */
function formDecode(body: string): Obj {
  const out: Obj = {};
  for (const [key, value] of new URLSearchParams(body)) {
    const path = key.replace(/\]/g, '').split('[');
    let node = out as Record<string, unknown>;
    path.forEach((k, i) => {
      if (i === path.length - 1) node[k] = value;
      else node = (node[k] ??= {}) as Record<string, unknown>;
    });
  }
  return out;
}

/**
 * A small Stripe: customers, one price (100 lei a month), Checkout sessions with a test payment
 * page, subscriptions, the customer portal (cancel), and signed webhooks to the local
 * stripe-webhook function — so the whole payment path runs for real, only without cards.
 * Test hooks: POST /stripe/_fail/<customer>[?final=1], POST /stripe/_end/<customer>.
 */
function stripeStandIn() {
  let seq = 0;
  const id = (prefix: string) => `${prefix}_local_${Date.now().toString(36)}${(++seq).toString(36)}`;
  const customers = new Map<string, Obj>();
  const sessions = new Map<string, Obj>();
  const subscriptions = new Map<string, Obj>();
  const byKey = new Map<string, Obj>();
  const price = { id: 'price_local_monthly', object: 'price', unit_amount: 10000, currency: 'ron', product: 'prod_local' };
  const month = 30 * 86_400;
  const now = () => Math.floor(Date.now() / 1000);

  async function send(type: string, object: Obj) {
    const payload = JSON.stringify({ id: id('evt'), object: 'event', type, data: { object } });
    const t = now();
    const v1 = createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
    const res = await fetch(`${FUNCTIONS_URL}/stripe-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${v1}` },
      body: payload,
    });
    if (!res.ok) throw new Error(`webhook ${type}: ${res.status} ${await res.text()}`);
  }

  function invoice(sub: Obj, paid: boolean, extra: Obj = {}): Obj {
    const amount = Number((sub as { amount?: number }).amount ?? 10000);
    return {
      id: id('in'),
      object: 'invoice',
      number: `LOCAL-${seq}`,
      customer: sub.customer,
      amount_paid: paid ? amount : 0,
      amount_due: amount,
      currency: 'ron',
      hosted_invoice_url: `${PAGES}/receipt/${seq}`,
      status_transitions: { paid_at: paid ? now() : null },
      lines: { data: [{ period: { start: now(), end: now() + month } }] },
      parent: { subscription_details: { subscription: sub.id } },
      ...extra,
    };
  }

  const subFor = (customer: string) => [...subscriptions.values()].reverse().find((s) => s.customer === customer);

  function page(res: http.ServerResponse, title: string, body: string) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`);
  }

  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://local');
        const path = url.pathname.replace(/^\/stripe/, '');
        const body = formDecode(Buffer.concat(chunks).toString('utf8'));
        const reply = (status: number, data: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        };
        const redirect = (to: string) => {
          res.statusCode = 303;
          res.setHeader('Location', to);
          res.end();
        };
        let m: RegExpExecArray | null;

        // ---------------------------------------------------------------- the API
        if (path.startsWith('/v1/')) {
          if (req.headers.authorization !== `Bearer ${STRIPE_KEY}`) return reply(401, { error: { message: 'bad key' } });
          const key = String(req.headers['idempotency-key'] ?? '');
          if (key && byKey.has(key)) return reply(200, byKey.get(key));
          const remember = (o: Obj) => {
            if (key) byKey.set(key, o);
            return reply(200, o);
          };
          if (req.method === 'POST' && path === '/v1/customers') {
            const c = { id: id('cus'), object: 'customer', ...body };
            customers.set(c.id, c);
            return remember(c);
          }
          if (req.method === 'POST' && (m = /^\/v1\/customers\/([^/]+)$/.exec(path))) {
            const c = { ...(customers.get(m[1]!) ?? { id: m[1] }), ...body };
            customers.set(m[1]!, c);
            return reply(200, c);
          }
          if (req.method === 'GET' && path === `/v1/prices/${price.id}`) return reply(200, price);
          if (req.method === 'POST' && path === '/v1/checkout/sessions') {
            const items = (body.line_items as Obj)['0'] as Obj;
            const amount = items.price ? price.unit_amount : Number((items.price_data as Obj).unit_amount);
            const s: Obj = { id: id('cs'), object: 'checkout.session', mode: 'subscription', ...body, amount };
            s.url = `${PAGES}/pay/${s.id}`;
            sessions.set(String(s.id), s);
            return remember(s);
          }
          if (req.method === 'GET' && (m = /^\/v1\/subscriptions\/([^/]+)$/.exec(path))) {
            const sub = subscriptions.get(m[1]!);
            return sub ? reply(200, sub) : reply(404, { error: { message: 'No such subscription' } });
          }
          if (req.method === 'DELETE' && (m = /^\/v1\/subscriptions\/([^/]+)$/.exec(path))) {
            const sub = subscriptions.get(m[1]!);
            if (!sub) return reply(404, { error: { message: 'No such subscription' } });
            Object.assign(sub, { status: 'canceled', cancellation_details: { reason: 'cancellation_requested' } });
            await send('customer.subscription.deleted', sub);
            return reply(200, sub);
          }
          if (req.method === 'POST' && path === '/v1/billing_portal/sessions') {
            const back = encodeURIComponent(String(body.return_url));
            return reply(200, { id: id('bps'), url: `${PAGES}/portal/${String(body.customer)}?return=${back}` });
          }
          return reply(404, { error: { message: `stand-in: no ${req.method} ${path}` } });
        }

        // ---------------------------------------------------------------- Checkout's page
        if ((m = /^\/pay\/([^/]+)$/.exec(path))) {
          const s = sessions.get(m[1]!);
          if (!s) return reply(404, {});
          const lei = Number(s.amount) / 100;
          return page(
            res,
            'Stripe test checkout',
            `<p>Abonament: ${lei} lei / lună</p><form method="post" action="${PAGES}/pay/${s.id}/complete"><button type="submit">Plătește</button></form><a href="${String(s.cancel_url)}">Înapoi</a>`,
          );
        }
        if (req.method === 'POST' && (m = /^\/pay\/([^/]+)\/complete$/.exec(path))) {
          const s = sessions.get(m[1]!);
          if (!s) return reply(404, {});
          const data = (s.subscription_data ?? {}) as Obj;
          const trialEnd = data.trial_end ? Number(data.trial_end) : null;
          const sub: Obj = {
            id: id('sub'),
            object: 'subscription',
            customer: s.customer,
            status: trialEnd ? 'trialing' : 'active',
            cancel_at_period_end: false,
            trial_end: trialEnd,
            metadata: data.metadata ?? {},
            items: { data: [{ current_period_end: trialEnd ?? now() + month }] },
            amount: s.amount,
          };
          subscriptions.set(String(sub.id), sub);
          try {
            if (!trialEnd) await send('invoice.paid', invoice(sub, true));
            await send('checkout.session.completed', { ...s, subscription: sub.id, status: 'complete' });
          } catch (e) {
            return reply(500, { error: String(e) });
          }
          return redirect(String(s.success_url));
        }

        // ---------------------------------------------------------------- the portal
        if ((m = /^\/portal\/([^/]+)$/.exec(path))) {
          const back = url.searchParams.get('return') ?? '/';
          return page(
            res,
            'Stripe test portal',
            `<form method="post" action="${PAGES}/portal/${m[1]}/cancel?return=${encodeURIComponent(back)}"><button type="submit">Anulează abonamentul</button></form><a href="${back}">Înapoi</a>`,
          );
        }
        if (req.method === 'POST' && (m = /^\/portal\/([^/]+)\/cancel$/.exec(path))) {
          const sub = subFor(m[1]!);
          if (sub) {
            sub.cancel_at_period_end = true;
            await send('customer.subscription.updated', sub);
          }
          return redirect(url.searchParams.get('return') ?? '/');
        }
        if (/^\/receipt\/\d+$/.test(path)) return page(res, 'Stripe test receipt', '<p>Chitanță</p>');

        // ---------------------------------------------------------------- test hooks
        if (req.method === 'POST' && (m = /^\/_fail\/([^/]+)$/.exec(path))) {
          const sub = subFor(m[1]!);
          if (!sub) return reply(404, {});
          const final = url.searchParams.get('final') === '1';
          // Like Stripe: the subscription is past due (or, after the last try, unpaid) by the time
          // the failed invoice is announced.
          sub.status = final ? 'unpaid' : 'past_due';
          await send(
            'invoice.payment_failed',
            invoice(sub, false, { attempt_count: final ? 4 : 1, next_payment_attempt: final ? null : now() + 3 * 86_400 }),
          );
          await send('customer.subscription.updated', sub);
          return reply(200, sub);
        }
        if (req.method === 'POST' && (m = /^\/_end\/([^/]+)$/.exec(path))) {
          const sub = subFor(m[1]!);
          if (!sub) return reply(404, {});
          Object.assign(sub, {
            status: 'canceled',
            cancellation_details: { reason: sub.cancel_at_period_end ? 'cancellation_requested' : 'payment_failed' },
          });
          await send('customer.subscription.deleted', sub);
          return reply(200, sub);
        }
        reply(404, { message: 'not found' });
      })().catch((e: unknown) => {
        res.statusCode = 500;
        res.end(String(e));
      });
    });
  };
}

/** Test hooks of the Stripe stand-in: a failed payment (the last one with `final`), the end. */
export async function stripeFailPayment(customer: string, final = false): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${PROVIDERS_PORT}/stripe/_fail/${customer}${final ? '?final=1' : ''}`, { method: 'POST' });
  expect(res.ok, await res.clone().text()).toBe(true);
}

export async function stripeEndSubscription(customer: string): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${PROVIDERS_PORT}/stripe/_end/${customer}`, { method: 'POST' });
  expect(res.ok, await res.clone().text()).toBe(true);
}
