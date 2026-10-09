import { describe, expect, it } from 'vitest';
import { bestOffer, quietPercentOn, weekdayOf, type ShopOffers } from '../../src/lib/offers';

const offers: ShopOffers = {
  newClient: { percent: 10, until: '2026-10-31', services: [{ id: 'frane', name_ro: 'Frâne', name_en: 'Brakes' }] },
  quietDay: { percent: 15, days: [1, 2] }, // Monday, Tuesday
};

describe('offers', () => {
  it('knows the weekday of a calendar day', () => {
    expect(weekdayOf('2026-10-12')).toBe(1); // Monday
    expect(weekdayOf('2026-10-11')).toBe(0); // Sunday
  });

  it('shows the quiet-day percent only on its days', () => {
    expect(quietPercentOn(offers, '2026-10-12')).toBe(15);
    expect(quietPercentOn(offers, '2026-10-14')).toBeNull();
  });

  it('never adds them up: the larger one, the new-client offer on a tie', () => {
    expect(bestOffer(offers, '2026-10-12', ['frane'])).toEqual({ percent: 15, kind: 'quiet_day' });
    expect(bestOffer(offers, '2026-10-14', ['frane'])).toEqual({ percent: 10, kind: 'new_client' });
    expect(bestOffer({ ...offers, quietDay: { percent: 10, days: [3] } }, '2026-10-14', ['frane'])).toEqual({ percent: 10, kind: 'new_client' });
  });

  it('the new-client offer ends on its last day and covers only its services', () => {
    expect(bestOffer(offers, '2026-11-04', ['frane'])).toBeNull(); // a Wednesday after the end
    expect(bestOffer(offers, '2026-10-14', ['ulei'])).toBeNull();
    expect(bestOffer({ newClient: { percent: 5, until: null, services: null }, quietDay: null }, '2027-01-06', ['ulei'])).toEqual({
      percent: 5,
      kind: 'new_client',
    });
  });
});
