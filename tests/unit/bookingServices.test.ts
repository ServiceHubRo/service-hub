import { describe, expect, it } from 'vitest';
import {
  bookingServiceNames,
  bookingServicesText,
  MAX_BOOKING_SERVICES,
  parseServiceIds,
  servicesLine,
  toggleServiceId,
} from '../../src/lib/bookingServices';

describe('several services in one booking', () => {
  it('reads the services from the address: each once, in order, at most five', () => {
    expect(parseServiceIds('ulei')).toEqual(['ulei']);
    expect(parseServiceIds(' ulei, frane ,ulei,,itp ')).toEqual(['ulei', 'frane', 'itp']);
    expect(parseServiceIds('a,b,c,d,e,f,g')).toHaveLength(MAX_BOOKING_SERVICES);
    expect(parseServiceIds(null)).toEqual([]);
  });

  it('ticks and unticks, never more than five', () => {
    expect(toggleServiceId([], 'ulei')).toEqual(['ulei']);
    expect(toggleServiceId(['ulei', 'frane'], 'ulei')).toEqual(['frane']);
    expect(toggleServiceId(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('says them in one short line', () => {
    const more = (first: string, n: number) => `${first} și încă ${n}`;
    expect(servicesLine(['Ulei'], more)).toBe('Ulei');
    expect(servicesLine(['Ulei', 'Frâne'], more)).toBe('Ulei, Frâne');
    expect(servicesLine(['Ulei', 'Frâne', 'ITP'], more)).toBe('Ulei și încă 2');
    expect(servicesLine([], more)).toBe('');
  });

  it('names every service of a booking in the reader language', () => {
    const oil = { name_ro: 'Schimb ulei + filtru ulei', name_en: 'Oil & oil filter change' };
    const pads = { name_ro: 'Plăcuțe de frână', name_en: 'Brake pads' };
    expect(bookingServiceNames('en', oil, [pads], 'ulei')).toEqual(['Oil & oil filter change', 'Brake pads']);
    expect(bookingServicesText('ro', oil, [pads], 'ulei')).toBe('Schimb ulei + filtru ulei, Plăcuțe de frână');
    expect(bookingServicesText('ro', null, undefined, 'ulei')).toBe('ulei');
    expect(bookingServicesText('ro', oil, null, 'ulei')).toBe('Schimb ulei + filtru ulei');
  });
});
