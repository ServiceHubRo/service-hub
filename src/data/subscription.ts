import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import type { SubscriptionRow } from '../lib/subscription';
import { subscribeRows } from './realtime';
import { failure, RpcError } from './rpc';
import { supabase } from './supabase';

/**
 * The shop's subscription (FR §4.7, T14). The owner reads the row and the invoices straight from
 * the tables (RLS: owner and admin only — staff get nothing). Paying and managing happen on
 * Stripe's pages, opened through the Edge Functions `stripe-checkout` and `stripe-portal`; only
 * Stripe's webhook changes the status, which arrives here through Realtime.
 */

export interface Invoice {
  id: string;
  amount: number;
  currency: string;
  issued_at: string | null;
  period_end: string | null;
  status: string;
  /** Stripe's receipt page. */
  receipt_url: string | null;
  /** The fiscal invoice (T14b), when issued. */
  pdf_url: string | null;
  series: string | null;
  number: string | null;
  provider_ref: string | null;
}

export interface SubscriptionData {
  shopId: string;
  subscription: SubscriptionRow;
  invoices: Invoice[];
  /** The billing data an invoice needs (Setări → Date de facturare) is complete. */
  billingComplete: boolean;
}

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

const SUBSCRIPTION_COLUMNS =
  'shop_id, status, trial_ends_at, current_period_end, cancel_at_period_end, price_ron, stripe_customer_id, stripe_status, ended_reason, next_payment_attempt, created_at';

/** The caller's subscription, or null when they are not the owner of a shop. */
export async function getSubscriptionRow(): Promise<(SubscriptionRow & { shop_id: string }) | null> {
  const { data, error } = await db().from('subscriptions').select(SUBSCRIPTION_COLUMNS).maybeSingle();
  if (error) throw failure(error);
  return data ? { ...data, price_ron: Number(data.price_ron) } : null;
}

/** Everything the Abonament screen shows; null for anyone but the shop's owner. */
export async function getSubscription(): Promise<SubscriptionData | null> {
  const row = await getSubscriptionRow();
  if (!row) return null;
  const [invoices, billing] = await Promise.all([
    db()
      .from('invoices')
      .select('id, amount, currency, issued_at, period_end, status, receipt_url, pdf_url, series, number, provider_ref')
      .eq('shop_id', row.shop_id)
      .order('issued_at', { ascending: false }),
    db()
      .from('shop_billing')
      .select('legal_name, vat_id, reg_com, legal_address, billing_email')
      .eq('shop_id', row.shop_id)
      .maybeSingle(),
  ]);
  if (invoices.error) throw failure(invoices.error);
  if (billing.error) throw failure(billing.error);
  const b = billing.data;
  return {
    shopId: row.shop_id,
    subscription: row,
    invoices: (invoices.data ?? []).map((i) => ({ ...i, amount: Number(i.amount) })),
    billingComplete: Boolean(
      b && b.legal_name?.trim() && b.vat_id && b.reg_com && b.legal_address?.trim() && b.billing_email,
    ),
  };
}

/** Changes to the subscription row and new invoices, for a quiet re-read. */
export function subscribeSubscription(shopId: string, onChange: () => void): () => void {
  const stops = ['subscriptions', 'invoices'].map((table) =>
    subscribeRows({ channel: `subscription-${table}:${shopId}`, table, filter: `shop_id=eq.${shopId}`, onChange, onResync: onChange }),
  );
  return () => stops.forEach((stop) => stop());
}

/** Why Stripe's page could not be opened, besides the database's refusals (RpcError). */
export type PaymentProblem = 'billing_incomplete' | 'subscription_exists' | 'payments_unavailable' | 'no_customer' | 'nothing_to_pay';

const PROBLEMS: ReadonlySet<string> = new Set([
  'billing_incomplete',
  'subscription_exists',
  'payments_unavailable',
  'no_customer',
  'nothing_to_pay',
]);

export class PaymentError extends Error {
  constructor(readonly problem: PaymentProblem) {
    super(problem);
    this.name = 'PaymentError';
  }
}

async function stripePage(fn: 'stripe-checkout' | 'stripe-portal', body: Record<string, unknown>): Promise<string> {
  const { data, error } = await db().functions.invoke<{ url?: string }>(fn, { method: 'POST', body });
  if (!error && typeof data?.url === 'string') return data.url;
  if (error instanceof FunctionsFetchError) throw new RpcError('network');
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    if (res.status === 401) throw failure({ code: 'PGRST301' });
    let code: unknown = null;
    try {
      code = ((await res.json()) as { error?: unknown }).error;
    } catch {
      // no body
    }
    if (typeof code === 'string' && PROBLEMS.has(code)) throw new PaymentError(code as PaymentProblem);
    throw failure({ message: code });
  }
  throw new RpcError('unknown');
}

/** The Stripe Checkout page for "Activează abonamentul". */
export function startCheckout(requestId: string): Promise<string> {
  return stripePage('stripe-checkout', { request_id: requestId });
}

/** Stripe's customer portal for "Gestionează abonamentul". */
export function openBillingPortal(): Promise<string> {
  return stripePage('stripe-portal', {});
}
