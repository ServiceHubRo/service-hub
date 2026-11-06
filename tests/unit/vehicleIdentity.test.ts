import { describe, expect, it } from 'vitest';
import { duplicateGroups, sameIdentity } from '../../src/lib/vehicleIdentity';

describe('vehicle identity (T66)', () => {
  it('the VIN decides when both cars have one', () => {
    expect(sameIdentity({ id: 'a', vin: 'wvwzzzauzgw123456', plate: 'BV 12 ABC' }, { id: 'b', vin: 'WVWZZZAUZGW123456', plate: 'B 1 X' })).toBe(true);
    expect(sameIdentity({ id: 'a', vin: 'WVWZZZAUZGW123456', plate: 'BV 12 ABC' }, { id: 'b', vin: 'UU1LSDAAG12345678', plate: 'BV-12-ABC' })).toBe(false);
  });

  it('else the plate, written any way', () => {
    expect(sameIdentity({ id: 'a', vin: 'WVWZZZAUZGW123456', plate: 'BV 12 ABC' }, { id: 'b', plate: 'bv-12-abc' })).toBe(true);
    expect(sameIdentity({ id: 'a', plate: '' }, { id: 'b', plate: '' })).toBe(false);
    expect(sameIdentity({ id: 'a' }, { id: 'b' })).toBe(false);
  });

  it('groups only the copies', () => {
    const cars = [
      { id: '1', plate: 'BV 12 ABC' },
      { id: '2', plate: 'B 1 X' },
      { id: '3', plate: 'bv12abc' },
      { id: '4' },
      { id: '5' },
    ];
    expect(duplicateGroups(cars).map((g) => g.map((c) => c.id))).toEqual([['1', '3']]);
  });
});
