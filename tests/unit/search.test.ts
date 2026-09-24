import { describe, expect, it } from 'vitest';
import { formatDateRange, formatDayMonth, formatDistance, formatRating } from '../../src/i18n/format';
import { plural } from '../../src/i18n/translate';
import { distanceKm, distanceTo, nearby, NEARBY_MAX, sortByDistance } from '../../src/lib/geo';
import { groupHours, type DayHours } from '../../src/lib/hours';
import { cityNamedBy, searchWords } from '../../src/lib/text';

const BRASOV = { latitude: 45.644, longitude: 25.587 };
const CODLEA = { latitude: 45.6969, longitude: 25.4439 };

describe('distance', () => {
  it('matches the database formula (Codlea → Brașov ≈ 12,4 km)', () => {
    const d = distanceKm(CODLEA, BRASOV);
    expect(d).toBeGreaterThan(12);
    expect(d).toBeLessThan(13);
    expect(distanceKm(BRASOV, BRASOV)).toBe(0);
  });

  it('is null without a location or without shop coordinates', () => {
    expect(distanceTo(null, { latitude: 45, longitude: 25 })).toBeNull();
    expect(distanceTo(BRASOV, { latitude: null, longitude: null })).toBeNull();
  });

  const shops = [
    { name: 'A', latitude: CODLEA.latitude, longitude: CODLEA.longitude }, // best rated, far
    { name: 'B', latitude: null, longitude: null }, // no coordinates
    { name: 'C', latitude: 45.65, longitude: 25.6 }, // close
    { name: 'D', latitude: 44.43, longitude: 26.1 }, // Bucharest, far away
    { name: 'E', latitude: BRASOV.latitude, longitude: BRASOV.longitude }, // here
  ];
  const dist = (s: (typeof shops)[number]) => distanceTo(BRASOV, s);

  it('"Cele mai apropiate": nearest first, shops without coordinates last in rating order', () => {
    expect(sortByDistance(shops, dist).map((s) => s.name)).toEqual(['E', 'C', 'A', 'D', 'B']);
    expect(shops.map((s) => s.name)).toEqual(['A', 'B', 'C', 'D', 'E']); // input untouched
  });

  it('"Aproape de tine": only within the radius, at most a few', () => {
    expect(nearby(shops, dist).map((s) => s.name)).toEqual(['E', 'C', 'A']);
    expect(nearby(shops, dist).length).toBeLessThanOrEqual(NEARBY_MAX);
    expect(nearby(shops, () => null)).toEqual([]);
  });
});

describe('groupHours', () => {
  const week = (overrides: Partial<Record<number, Partial<DayHours>>> = {}): DayHours[] =>
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      is_closed: weekday === 0 || weekday === 6,
      open_time: '08:00',
      close_time: '18:00',
      ...overrides[weekday],
    }));

  it('groups consecutive days with the same hours, Monday first', () => {
    expect(groupHours(week({ 6: { is_closed: false, open_time: '09:00', close_time: '14:00' } }))).toEqual([
      { days: [1, 2, 3, 4, 5], closed: false, open: '08:00', close: '18:00' },
      { days: [6], closed: false, open: '09:00', close: '14:00' },
      { days: [0], closed: true, open: null, close: null },
    ]);
  });

  it('weekend closed together; a different day in the middle splits the group', () => {
    expect(groupHours(week({ 3: { close_time: '16:00' } })).map((r) => r.days)).toEqual([[1, 2], [3], [4, 5], [6, 0]]);
  });

  it('closed days ignore leftover times', () => {
    const rows = groupHours(week({ 1: { is_closed: true, open_time: '07:00' } }));
    expect(rows[0]).toEqual({ days: [1], closed: true, open: null, close: null });
  });
});

describe('searchWords (same rule as search_words in SQL)', () => {
  it('folds, splits and makes the plural s and the last vowel optional', () => {
    expect(searchWords('  Frânele, BRAKES / oil-change  ')).toEqual(['franel', 'brak', 'oil', 'chang']);
    expect(searchWords('frane')).toEqual(['fran']);
    expect(searchWords('ulei')).toEqual(['ule']);
    expect(searchWords('ITP')).toEqual(['itp']);
    expect(searchWords('bus')).toEqual(['bus']);
  });
});

describe('cityNamedBy', () => {
  const cities = [{ city: 'Brașov' }, { city: 'Codlea' }];
  it('finds the city a query names, without case or diacritics', () => {
    expect(cityNamedBy('brasov', cities)).toBe('Brașov');
    expect(cityNamedBy('  BRAȘOV ', cities)).toBe('Brașov');
    expect(cityNamedBy('Braşov', cities)).toBe('Brașov'); // cedilla ş
    expect(cityNamedBy('codlea', cities)).toBe('Codlea');
  });
  it('only on an exact name', () => {
    expect(cityNamedBy('bras', cities)).toBeNull();
    expect(cityNamedBy('brasov frane', cities)).toBeNull();
    expect(cityNamedBy('', cities)).toBeNull();
  });
});

describe('search formats', () => {
  it('distance: one decimal under 10 km, whole km after', () => {
    expect(formatDistance('ro', 2.345)).toBe('2,3 km');
    expect(formatDistance('en', 2.345)).toBe('2.3 km');
    expect(formatDistance('ro', 0.04)).toBe('0,0 km');
    expect(formatDistance('ro', 12.6)).toBe('13 km');
    expect(formatDistance('en', 1234.4)).toBe('1,234 km');
  });

  it('rating with one decimal', () => {
    expect(formatRating('ro', 4.8)).toBe('4,8');
    expect(formatRating('en', 5)).toBe('5.0');
  });

  it('day and month, the year only when it is not this year', () => {
    const now = new Date('2026-09-24T10:00:00Z');
    expect(formatDayMonth('ro', '2026-10-20', now)).toBe('20 oct');
    expect(formatDayMonth('en', '2026-10-20', now)).toBe('Oct 20');
    expect(formatDayMonth('ro', '2027-01-03', now)).toBe('3 ian 2027');
    expect(formatDayMonth('en', '2027-01-03', now)).toBe('Jan 3, 2027');
    expect(formatDateRange('ro', '2026-10-20', '2026-10-22', now)).toBe('20 oct – 22 oct');
    expect(formatDateRange('en', '2026-10-20', '2026-10-20', now)).toBe('Oct 20');
  });

  it('counts shops, reviews and services in Romanian (1 / 2–19 / 20+ de) and English', () => {
    expect(plural('ro', 'unit.shops', 1)).toBe('1 service');
    expect(plural('ro', 'unit.shops', 7)).toBe('7 service-uri');
    expect(plural('ro', 'unit.shops', 20)).toBe('20 de service-uri');
    expect(plural('ro', 'unit.reviews', 3)).toBe('3 recenzii');
    expect(plural('ro', 'unit.services', 1)).toBe('1 serviciu');
    expect(plural('en', 'unit.shops', 1)).toBe('1 shop');
    expect(plural('en', 'unit.reviews', 12)).toBe('12 reviews');
    expect(plural('ro', 'unit.shops', 0)).toBe('0 service-uri');
  });
});
