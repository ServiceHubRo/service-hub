import { describe, expect, it } from 'vitest';
import { billedSeats, seatLineItem, syncSeats, type SeatInfo, type SeatPrice } from '../../supabase/functions/_shared/seats';
import { StripeError, type StripeApi } from '../../supabase/functions/_shared/stripe';

const price: SeatPrice = { id: 'price_seat', product: 'prod_seat', unitAmount: 2000, currency: 'ron' };

const info = (over: Partial<SeatInfo> = {}): SeatInfo => ({
  shop_id: 'shop1',
  seats: 2,
  seat_price_ron: 20,
  billed_seats: null,
  stripe_subscription_id: 'sub_1',
  stripe_status: 'active',
  ...over,
});

/** A Stripe that knows one subscription and records every change. */
function fakeStripe(items: Record<string, unknown>[], status = 'active') {
  const calls: { method: string; path: string; params?: Record<string, unknown>; key?: string }[] = [];
  const api: StripeApi = {
    get: async (path) => {
      calls.push({ method: 'GET', path });
      if (path !== 'subscriptions/sub_1') throw new StripeError(404, 'no such');
      return { id: 'sub_1', status, items: { data: items } };
    },
    post: async (path, params, key) => {
      calls.push({ method: 'POST', path, params, key });
      return {};
    },
    del: async (path, params) => {
      calls.push({ method: 'DELETE', path, params });
      return {};
    },
  };
  return { api, calls };
}

const main = { id: 'si_main', price: { id: 'price_main', product: 'prod_main' }, quantity: 1 };

describe('the colleagues in Stripe', () => {
  it('bills the Stripe price when the amounts match, else the same product at the shop amount', () => {
    expect(seatLineItem(price, 20, 2)).toEqual({ price: 'price_seat', quantity: 2 });
    expect(seatLineItem(price, 15, 1)).toEqual({
      price_data: { currency: 'ron', product: 'prod_seat', unit_amount: 1500, recurring: { interval: 'month' } },
      quantity: 1,
    });
    expect(seatLineItem(price, 20, 0)).toBeNull();
  });

  it('reads how many colleagues a subscription charges for, by price or by product', () => {
    expect(billedSeats({ items: { data: [main, { id: 'si_s', price: { id: 'price_seat' }, quantity: 3 }] } }, price)).toBe(3);
    expect(billedSeats({ items: { data: [main, { id: 'si_s', price: { id: 'price_x', product: 'prod_seat' }, quantity: 1 }] } }, price)).toBe(1);
    expect(billedSeats({ items: { data: [main] } }, price)).toBe(0);
  });

  it('adds the item for the first colleague, prorated, with an idempotency key', async () => {
    const { api, calls } = fakeStripe([main]);
    expect(await syncSeats(api, price, info({ seats: 1 }), 'event-1')).toEqual({ status: 'added', billed: 1 });
    const add = calls.find((c) => c.method === 'POST')!;
    expect(add.path).toBe('subscription_items');
    expect(add.params).toMatchObject({ subscription: 'sub_1', price: 'price_seat', quantity: 1, proration_behavior: 'create_prorations' });
    expect(add.key).toBe('seat-item-sub_1-event-1');
  });

  it('changes the quantity, removes the item when nobody is left, and does nothing when it matches', async () => {
    const seat = { id: 'si_seat', price: { id: 'price_seat', product: 'prod_seat' }, quantity: 2 };

    let f = fakeStripe([main, seat]);
    expect(await syncSeats(f.api, price, info({ seats: 3 }), 'e')).toEqual({ status: 'updated', billed: 3 });
    expect(f.calls.at(-1)).toMatchObject({ method: 'POST', path: 'subscription_items/si_seat', params: { quantity: 3 } });

    f = fakeStripe([main, seat]);
    expect(await syncSeats(f.api, price, info({ seats: 0 }), 'e')).toEqual({ status: 'removed', billed: 0 });
    expect(f.calls.at(-1)).toMatchObject({ method: 'DELETE', path: 'subscription_items/si_seat', params: { proration_behavior: 'create_prorations' } });

    f = fakeStripe([main, seat]);
    expect(await syncSeats(f.api, price, info({ seats: 2 }), 'e')).toEqual({ status: 'unchanged', billed: 2 });
    expect(f.calls.filter((c) => c.method !== 'GET')).toEqual([]);

    f = fakeStripe([main]);
    expect(await syncSeats(f.api, price, info({ seats: 0 }), 'e')).toEqual({ status: 'unchanged', billed: 0 });
  });

  it('leaves alone a shop Stripe does not run a subscription for', async () => {
    let f = fakeStripe([main]);
    expect(await syncSeats(f.api, price, info({ stripe_status: null }), 'e')).toEqual({ status: 'no_subscription', billed: null });
    expect(f.calls).toEqual([]);
    f = fakeStripe([main], 'canceled');
    expect((await syncSeats(f.api, price, info(), 'e')).status).toBe('no_subscription');
    f = fakeStripe([main]);
    expect((await syncSeats(f.api, price, info({ stripe_subscription_id: 'sub_gone' }), 'e')).status).toBe('no_subscription');
  });

  it('bills a colleague the period price on a longer subscription, invoiced at once', async () => {
    expect(seatLineItem(price, 19, 2, 12, 15)).toEqual({
      price_data: { currency: 'ron', product: 'prod_seat', unit_amount: 19400, recurring: { interval: 'month', interval_count: 12 } },
      quantity: 2,
    });
    // Even when the amount happens to match the monthly Stripe price, a period needs its own.
    expect(seatLineItem({ ...price, unitAmount: 5400 }, 19, 1, 3, 5)).toMatchObject({ price_data: { unit_amount: 5400 } });

    let f = fakeStripe([main]);
    await syncSeats(f.api, price, info({ seats: 1, seat_price_ron: 19, billing_months: 3, period_discount: 5 }), 'e');
    expect(f.calls.at(-1)!.params).toMatchObject({
      price_data: { unit_amount: 5400, recurring: { interval: 'month', interval_count: 3 } },
      proration_behavior: 'always_invoice',
    });
    const seat = { id: 'si_seat', price: { id: 'price_x', product: 'prod_seat' }, quantity: 1 };
    f = fakeStripe([main, seat]);
    await syncSeats(f.api, price, info({ seats: 2, billing_months: 12, period_discount: 15 }), 'e');
    expect(f.calls.at(-1)).toMatchObject({ path: 'subscription_items/si_seat', params: { quantity: 2, proration_behavior: 'always_invoice' } });
  });

  it('keeps a shop price per colleague that differs from Stripe', async () => {
    const { api, calls } = fakeStripe([main]);
    await syncSeats(api, price, info({ seats: 1, seat_price_ron: 15 }), 'e');
    expect(calls.at(-1)!.params).toMatchObject({ price_data: { unit_amount: 1500, product: 'prod_seat' }, quantity: 1 });
  });
});
