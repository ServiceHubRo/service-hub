// Stripe, with plain fetch and WebCrypto (ARCHITECTURE §12). No npm package: the functions start
// fast and this module stays free of Deno, so the unit tests load it.
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID; STRIPE_API_URL only for the
// local browser tests (a stand-in). Every call pins the API version, so the objects read here
// always have the shape this file expects, whatever the account's default version is.

export const STRIPE_API_VERSION = '2025-08-27.basil';

export interface StripeConfig {
  secretKey?: string;
  webhookSecret?: string;
  priceId?: string;
  url?: string;
  fetch?: typeof fetch;
}

export class StripeError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Stripe's form encoding: nested objects and arrays as `a[b][0][c]=…`. */
export function formEncode(params: Record<string, unknown>): string {
  const out: string[] = [];
  const walk = (prefix: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${prefix}[${i}]`, v));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(`${prefix}[${k}]`, v);
    } else {
      out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
    }
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out.join('&');
}

export function stripeApi(config: StripeConfig) {
  const base = (config.url ?? 'https://api.stripe.com').replace(/\/+$/, '');
  const doFetch = config.fetch ?? fetch;

  async function request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    if (!config.secretKey) throw new StripeError(0, 'stripe_not_configured');
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.secretKey}`,
      'Stripe-Version': STRIPE_API_VERSION,
    };
    let url = `${base}/v1/${path}`;
    let body: string | undefined;
    if (params && method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = formEncode(params);
    } else if (params) {
      url += `?${formEncode(params)}`;
    }
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey.slice(0, 255);
    const res = await doFetch(url, { method, headers, body, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const err = (data.error ?? {}) as { message?: string; code?: string };
      throw new StripeError(res.status, `stripe ${res.status}: ${err.message ?? text.slice(0, 200)}`, err.code);
    }
    return data;
  }

  return {
    get: (path: string, params?: Record<string, unknown>) => request('GET', path, params),
    post: (path: string, params: Record<string, unknown>, idempotencyKey?: string) =>
      request('POST', path, params, idempotencyKey),
    del: (path: string) => request('DELETE', path),
  };
}

export type StripeApi = ReturnType<typeof stripeApi>;

// ------------------------------------------------------------------------------------ webhook signature

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** HMAC-SHA256 of `${timestamp}.${payload}` as Stripe signs it (hex). */
export async function stripeSignature(secret: string, timestamp: number, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`)));
}

/**
 * Checks the Stripe-Signature header (`t=…,v1=…[,v1=…]`) against the raw body: a v1 signature
 * made with the endpoint secret, at most `toleranceSeconds` old (a replayed old event is refused).
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  now: number = Date.now(),
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!header || !secret) return false;
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2).map((s) => s.trim());
    if (k === 't') timestamp = Number(v);
    else if (k === 'v1' && v) signatures.push(v);
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = await stripeSignature(secret, timestamp, payload);
  return signatures.some((s) => sameText(s, expected));
}

// ------------------------------------------------------------------------------------ objects → database

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const idOf = (v: unknown): string | null =>
  typeof v === 'string' ? v || null : v && typeof v === 'object' ? str((v as { id?: unknown }).id) : null;
const iso = (v: unknown): string | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? new Date(v * 1000).toISOString() : null;
const money = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) / 100 : 0);

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

/** What sync_stripe_subscription needs from a Stripe subscription. */
export interface SubscriptionState {
  id: string;
  customer: string | null;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  trial_end: string | null;
  cancellation_reason: string | null;
}

export function subscriptionState(sub: Obj): SubscriptionState {
  // Since API version 2025-03-31 the period lives on the subscription items.
  const item = obj((obj(sub.items).data as unknown[] | undefined)?.[0]);
  return {
    id: String(sub.id ?? ''),
    customer: idOf(sub.customer),
    status: String(sub.status ?? ''),
    // A subscription can also be set to stop at a date (cancel_at), which the portal uses too.
    cancel_at_period_end: sub.cancel_at_period_end === true || (typeof sub.cancel_at === 'number' && sub.cancel_at > 0),
    current_period_end: iso(item.current_period_end) ?? iso(sub.current_period_end),
    trial_end: iso(sub.trial_end),
    cancellation_reason: str(obj(sub.cancellation_details).reason),
  };
}

/** The subscription an invoice belongs to (old and new API shapes). */
export function invoiceSubscriptionId(inv: Obj): string | null {
  return idOf(obj(obj(inv.parent).subscription_details).subscription) ?? idOf(inv.subscription);
}

/** What record_stripe_invoice needs from a paid invoice. */
export function paidInvoice(inv: Obj) {
  const line = obj((obj(inv.lines).data as unknown[] | undefined)?.[0]);
  const taxes = (inv.total_taxes as { amount?: number }[] | undefined) ?? [];
  const tax = taxes.length ? taxes.reduce((s, t) => s + (t.amount ?? 0), 0) : inv.tax;
  return {
    id: str(inv.id),
    number: str(inv.number),
    amount_paid: money(inv.amount_paid),
    tax: money(tax),
    currency: str(inv.currency) ?? 'ron',
    paid_at: iso(obj(inv.status_transitions).paid_at) ?? iso(inv.created),
    receipt_url: str(inv.hosted_invoice_url),
    period_end: iso(obj(line.period).end) ?? iso(inv.period_end),
  };
}

/** What record_payment_failed needs from a failed invoice. */
export function failedInvoice(inv: Obj) {
  return {
    id: str(inv.id),
    amount_due: money(inv.amount_due),
    attempt_count: typeof inv.attempt_count === 'number' ? inv.attempt_count : 0,
    next_payment_attempt: iso(inv.next_payment_attempt),
  };
}

// ------------------------------------------------------------------------------------ checkout

/** Stripe needs a free period to end at least 2 days after the checkout; shorter is charged now. */
export const MIN_TRIAL_SECONDS = 2 * 24 * 3600 + 3600;

/**
 * The end of the free period to hand to Stripe (unix seconds), or null to charge at once: the
 * rest of our free period is kept when the card is given early.
 */
export function trialEndForCheckout(trialEndsAt: string | null, status: string, now: number = Date.now()): number | null {
  if (status !== 'trial' || !trialEndsAt) return null;
  const end = Math.floor(new Date(trialEndsAt).getTime() / 1000);
  if (!Number.isFinite(end) || end - Math.floor(now / 1000) < MIN_TRIAL_SECONDS) return null;
  return end;
}

/** Stripe Checkout and the portal speak Romanian and English. */
export function stripeLocale(lang: string | null | undefined): 'ro' | 'en' {
  return lang === 'en' ? 'en' : 'ro';
}

/** Statuses in which a shop already has a working Stripe subscription. */
export const LIVE_STRIPE_STATUSES = ['trialing', 'active', 'past_due'] as const;

export function hasLiveSubscription(stripeStatus: string | null | undefined): boolean {
  return (LIVE_STRIPE_STATUSES as readonly string[]).includes(stripeStatus ?? '');
}
