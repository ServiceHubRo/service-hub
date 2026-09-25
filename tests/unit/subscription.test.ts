import { describe, expect, it } from 'vitest';
import { emailForEvent } from '../../supabase/functions/_shared/emails.ts';
import {
  failedInvoice,
  formEncode,
  invoiceSubscriptionId,
  paidInvoice,
  stripeSignature,
  subscriptionState,
  trialEndForCheckout,
  verifyStripeSignature,
} from '../../supabase/functions/_shared/stripe.ts';
import { renderNotification } from '../../supabase/functions/_shared/templates.ts';
import { includedColleagues, monthlyTotal, subscriptionView, trialWarningDays, type SubscriptionRow } from '../../src/lib/subscription';

describe('Stripe webhook signature', () => {
  const secret = 'whsec_test_secret';
  const payload = '{"id":"evt_1","type":"invoice.paid"}';
  const now = Date.UTC(2026, 9, 13, 9, 0, 0);
  const t = Math.floor(now / 1000);
  // Stripe's scheme: HMAC-SHA256 of "<timestamp>.<raw body>", hex (computed independently).
  const v1 = '26d777db006790e5f37ab2ed9939e4cfb092ce79a69d5c936457fea22bb3541d';

  it('signs like Stripe', async () => {
    expect(await stripeSignature(secret, t, payload)).toBe(v1);
  });

  it('accepts a valid signature, also among several', async () => {
    expect(await verifyStripeSignature(payload, `t=${t},v1=${v1}`, secret, now)).toBe(true);
    expect(await verifyStripeSignature(payload, `t=${t},v1=deadbeef,v1=${v1},v0=abc`, secret, now)).toBe(true);
  });

  it('refuses a changed body, a wrong secret, an old or missing header', async () => {
    expect(await verifyStripeSignature(payload.replace('evt_1', 'evt_2'), `t=${t},v1=${v1}`, secret, now)).toBe(false);
    expect(await verifyStripeSignature(payload, `t=${t},v1=${v1}`, 'whsec_other', now)).toBe(false);
    expect(await verifyStripeSignature(payload, `t=${t},v1=${v1}`, secret, now + 301_000)).toBe(false);
    expect(await verifyStripeSignature(payload, null, secret, now)).toBe(false);
    expect(await verifyStripeSignature(payload, `v1=${v1}`, secret, now)).toBe(false);
    expect(await verifyStripeSignature(payload, `t=${t}`, secret, now)).toBe(false);
  });
});

describe('Stripe objects', () => {
  it('form-encodes nested parameters', () => {
    expect(
      formEncode({
        mode: 'subscription',
        line_items: [{ price: 'price_1', quantity: 1 }],
        subscription_data: { metadata: { shop_id: 's-1' }, trial_end: 1766570400 },
        skip: undefined,
      }),
    ).toBe(
      'mode=subscription&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1' +
        '&subscription_data%5Bmetadata%5D%5Bshop_id%5D=s-1&subscription_data%5Btrial_end%5D=1766570400',
    );
  });

  it('reads a subscription in the current API shape (period on the item)', () => {
    expect(
      subscriptionState({
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: false,
        cancel_at: null,
        items: { data: [{ current_period_end: 1766570400 }] },
        cancellation_details: { reason: null },
      }),
    ).toEqual({
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: '2025-12-24T10:00:00.000Z',
      trial_end: null,
      cancellation_reason: null,
    });
  });

  it('reads the older shape and a stop date set by the portal', () => {
    const s = subscriptionState({
      id: 'sub_1',
      customer: { id: 'cus_1' },
      status: 'canceled',
      cancel_at: 1766570400,
      current_period_end: 1766570400,
      cancellation_details: { reason: 'cancellation_requested' },
    });
    expect(s.customer).toBe('cus_1');
    expect(s.cancel_at_period_end).toBe(true);
    expect(s.current_period_end).toBe('2025-12-24T10:00:00.000Z');
    expect(s.cancellation_reason).toBe('cancellation_requested');
  });

  it('reads paid and failed invoices, in lei', () => {
    const inv = {
      id: 'in_1',
      number: 'ABC-0001',
      customer: 'cus_1',
      amount_paid: 10000,
      amount_due: 10000,
      currency: 'ron',
      hosted_invoice_url: 'https://invoice.stripe.com/i/1',
      status_transitions: { paid_at: 1763978400 },
      lines: { data: [{ period: { start: 1763978400, end: 1766570400 } }] },
      parent: { subscription_details: { subscription: 'sub_1' } },
      attempt_count: 2,
      next_payment_attempt: 1764237600,
    };
    expect(paidInvoice(inv)).toMatchObject({
      id: 'in_1',
      number: 'ABC-0001',
      amount_paid: 100,
      tax: 0,
      currency: 'ron',
      receipt_url: 'https://invoice.stripe.com/i/1',
      paid_at: '2025-11-24T10:00:00.000Z',
      period_end: '2025-12-24T10:00:00.000Z',
    });
    expect(invoiceSubscriptionId(inv)).toBe('sub_1');
    expect(invoiceSubscriptionId({ subscription: 'sub_old' })).toBe('sub_old');
    expect(failedInvoice(inv)).toEqual({ id: 'in_1', amount_due: 100, attempt_count: 2, next_payment_attempt: '2025-11-27T10:00:00.000Z' });
    expect(failedInvoice({ id: 'in_2', amount_due: 10000, next_payment_attempt: null }).next_payment_attempt).toBeNull();
  });

  it('keeps the rest of the free period when the card is given early', () => {
    const now = Date.UTC(2026, 9, 1);
    const in30 = new Date(now + 30 * 86_400_000).toISOString();
    expect(trialEndForCheckout(in30, 'trial', now)).toBe(Math.floor((now + 30 * 86_400_000) / 1000));
    // Stripe needs at least 2 days: closer to the end, the first payment is made at once.
    expect(trialEndForCheckout(new Date(now + 36 * 3600_000).toISOString(), 'trial', now)).toBeNull();
    expect(trialEndForCheckout(in30, 'inactive', now)).toBeNull();
    expect(trialEndForCheckout(null, 'trial', now)).toBeNull();
  });
});

const row = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  status: 'trial',
  trial_ends_at: '2026-12-22T10:00:00Z',
  current_period_end: null,
  cancel_at_period_end: false,
  price_ron: 100,
  seat_price_ron: 20,
  free_seats: 1,
  seats: 0,
  stripe_customer_id: null,
  stripe_status: null,
  ended_reason: null,
  next_payment_attempt: null,
  created_at: '2026-09-23T10:00:00Z',
  ...over,
});

describe('the monthly total', () => {
  it('is the price plus 20 lei for each colleague with an account', () => {
    expect(monthlyTotal(row())).toBe(100);
    expect(monthlyTotal(row({ seats: 1 }))).toBe(120);
    expect(monthlyTotal(row({ seats: 2 }))).toBe(140);
    expect(monthlyTotal(row({ price_ron: 79.5, seats: 3, seat_price_ron: 15 }))).toBe(124.5);
  });
});

// 2026-10-09 12:00 in Bucharest.
const NOW = new Date('2026-10-09T09:00:00Z');

describe('where the subscription stands', () => {
  it('counts the free days left out of the free period', () => {
    expect(subscriptionView(row(), NOW)).toEqual({
      state: 'trial',
      goodStanding: true,
      daysLeft: 74,
      trialDays: 90,
      canCheckout: true,
      canManage: false,
    });
  });

  it('a card given in the free period: nothing to activate, something to manage', () => {
    const v = subscriptionView(row({ stripe_status: 'trialing', stripe_customer_id: 'cus_1' }), NOW);
    expect(v).toMatchObject({ state: 'trial_card', goodStanding: true, canCheckout: false, canManage: true, daysLeft: 74 });
    // Still in good standing when the end passed and Stripe has not answered yet.
    expect(subscriptionView(row({ stripe_status: 'trialing', trial_ends_at: '2026-10-01T00:00:00Z' }), NOW).goodStanding).toBe(true);
  });

  it('a free period over without a card is inactive even before the hourly job', () => {
    expect(subscriptionView(row({ trial_ends_at: '2026-10-09T08:00:00Z' }), NOW)).toMatchObject({
      state: 'inactive',
      goodStanding: false,
      canCheckout: true,
    });
  });

  it('paid, stopping, past due, ended', () => {
    const paid = { stripe_status: 'active', stripe_customer_id: 'cus_1', current_period_end: '2026-11-09T10:00:00Z' };
    expect(subscriptionView(row({ status: 'active', ...paid }), NOW)).toMatchObject({ state: 'active', canCheckout: false, canManage: true, daysLeft: null });
    expect(subscriptionView(row({ status: 'active', cancel_at_period_end: true, ...paid }), NOW).state).toBe('ending');
    expect(subscriptionView(row({ status: 'past_due', ...paid, stripe_status: 'past_due' }), NOW)).toMatchObject({
      state: 'past_due',
      goodStanding: true,
      canCheckout: false,
    });
    expect(subscriptionView(row({ status: 'inactive', stripe_status: 'canceled', stripe_customer_id: 'cus_1' }), NOW)).toMatchObject({
      state: 'inactive',
      canCheckout: true,
      canManage: true,
    });
    expect(subscriptionView(row({ status: 'cancelled', stripe_status: 'canceled' }), NOW)).toMatchObject({
      state: 'cancelled',
      goodStanding: false,
      canCheckout: true,
    });
  });

  it('warns on Panou in the last 7 days of the free period, without a card', () => {
    const sub = (trial_ends_at: string, card_given = false) => ({ status: 'trial', trial_ends_at, card_given });
    expect(trialWarningDays(sub('2026-10-17T10:00:00Z'), NOW)).toBeNull();
    expect(trialWarningDays(sub('2026-10-16T10:00:00Z'), NOW)).toBe(7);
    expect(trialWarningDays(sub('2026-10-09T20:00:00Z'), NOW)).toBe(0);
    expect(trialWarningDays(sub('2026-10-12T10:00:00Z', true), NOW)).toBeNull();
    expect(trialWarningDays(sub('2026-10-09T08:00:00Z'), NOW)).toBeNull();
    expect(trialWarningDays(undefined, NOW)).toBeNull();
  });
});

describe('subscription notices and emails', () => {
  const ev = (event: string, lang: 'ro' | 'en', params: Record<string, unknown>) => ({
    event,
    role: 'shop',
    lang,
    params: { shop_id: 's-1', shop_name: 'Atelier Unu', ...params },
    booking_id: null,
  });

  it('push texts lead to Abonament', () => {
    expect(renderNotification(ev('trial_ending', 'ro', { days: 7, expiry: '2026-10-16' }), {}, NOW)).toMatchObject({
      title: 'Perioada gratuită se termină',
      body: 'Perioada gratuită se termină în 7 zile, pe 16 oct. Activează abonamentul ca service-ul să rămână în căutări.',
      url: '/s/cont/abonament',
      tag: 'subscription',
    });
    expect(renderNotification(ev('trial_ending', 'en', { days: 1, expiry: '2026-10-10' }), {}, NOW)!.body).toBe(
      'Your free period ends in 1 day, on Oct 10. Activate the subscription to stay in search results.',
    );
    expect(renderNotification(ev('trial_ending', 'ro', { days: 0, expiry: '2026-10-09' }), {}, NOW)!.body).toBe(
      'Perioada gratuită se termină azi. Activează abonamentul ca service-ul să rămână în căutări.',
    );
    expect(renderNotification(ev('payment_failed', 'ro', { total: 100, final: false, expiry: '2026-10-12' }), {}, NOW)!.body).toBe(
      'Nu am putut încasa abonamentul de 100 lei. Verifică sau schimbă cardul din Abonament. Reîncercăm pe 12 oct.',
    );
    expect(renderNotification(ev('payment_failed', 'en', { total: 100, final: true, expiry: null }), {}, NOW)!.body).toBe(
      "We couldn't charge the 100 RON subscription. That was the last try: pay under Subscription to stay in search results.",
    );
    expect(renderNotification(ev('shop_inactive', 'ro', { reason: 'payment_failed' }), {}, NOW)!.body).toMatch(/^Plata abonamentului nu a trecut/);
    expect(renderNotification(ev('shop_inactive', 'en', { reason: 'cancelled' }), {}, NOW)!.body).toMatch(/^Your subscription has ended/);
    expect(renderNotification(ev('shop_inactive', 'ro', { reason: 'trial_ended' }), {}, NOW)!.body).toMatch(/^Perioada gratuită s-a încheiat/);
  });

  it('emails: payment received with the receipt, the others with Abonament', () => {
    const paid = emailForEvent(
      ev('invoice_paid', 'ro', {
        total: 100,
        number: 'ABC-0001',
        receipt_url: 'https://invoice.stripe.com/i/1',
        paid_at: '2026-10-09T09:00:00Z',
        period_end: '2026-11-09T09:00:00Z',
      }),
      'https://app.test',
    )!;
    expect(paid.subject).toBe('Plată primită: 100 lei');
    expect(paid.text).toContain('Activ până pe: 9 nov');
    expect(paid.text).toContain('Vezi chitanța: https://invoice.stripe.com/i/1');

    const ending = emailForEvent(ev('trial_ending', 'en', { days: 7, expiry: '2026-10-16', price: 100 }), 'https://app.test')!;
    expect(ending.subject).toBe('Your free period ends on Oct 16');
    expect(ending.text).toContain('(100 RON a month)');
    expect(ending.text).toContain('Activate the subscription: https://app.test/s/cont/abonament');

    const failed = emailForEvent(ev('payment_failed', 'ro', { total: 100, expiry: '2026-10-12' }), 'https://app.test')!;
    expect(failed.text).toContain('Reîncercăm pe 12 oct.');

    const inactive = emailForEvent(ev('shop_inactive', 'ro', { reason: 'trial_ended' }), 'https://app.test')!;
    expect(inactive.subject).toBe('Atelier Unu nu mai apare în căutări');
    expect(inactive.html).toContain('https://app.test/s/cont/abonament');
    for (const e of [paid, ending, failed, inactive]) expect(`${e.subject} ${e.text}`).not.toMatch(/undefined|null|NaN|\{|!/);
  });
});

describe('included colleagues', () => {
  it('names the first one, or how many', () => {
    expect(includedColleagues('ro', 0)).toBe('');
    expect(includedColleagues('ro', 1)).toBe('Primul coleg cu cont în service e inclus în abonament.');
    expect(includedColleagues('ro', 2)).toBe('Primii 2 colegi cu cont în service sunt incluși în abonament.');
    expect(includedColleagues('en', 1)).toBe('The first colleague with an account in the shop is included in the subscription.');
  });
});
