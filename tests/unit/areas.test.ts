import { describe, expect, it } from 'vitest';
import { areaForPoint } from '../../src/lib/areas';

// A few towns of the database's list (supabase/migrations/*_service_areas.sql); the same positions
// are checked against area_for_point() in tests/sql/116_service_areas.sql.
const AREAS = [
  { code: 'BV', anchors: [{ n: 'Brașov', lat: 45.65, lng: 25.61 }, { n: 'Codlea', lat: 45.7, lng: 25.45 }] },
  { code: 'CV', anchors: [{ n: 'Sfântu Gheorghe', lat: 45.86, lng: 25.79 }, { n: 'Covasna', lat: 45.85, lng: 26.18 }] },
  { code: 'B', anchors: [{ n: 'București', lat: 44.43, lng: 26.1 }, { n: 'Sector 1', lat: 44.47, lng: 26.06 }] },
  { code: 'IF', anchors: [{ n: 'Buftea', lat: 44.56, lng: 25.95 }, { n: 'Otopeni', lat: 44.55, lng: 26.07 }] },
];

const at = (latitude: number, longitude: number) => areaForPoint(AREAS, { latitude, longitude })?.code ?? null;

describe('the zone of a position', () => {
  it('is the zone of the nearest town', () => {
    expect(at(45.86, 25.79)).toBe('CV');
    expect(at(45.7, 25.45)).toBe('BV');
    expect(at(44.55, 26.07)).toBe('IF');
    expect(at(44.43, 26.1)).toBe('B');
  });

  it('is none outside Romania or without zones', () => {
    expect(at(48.85, 2.35)).toBeNull();
    expect(areaForPoint([], { latitude: 45.65, longitude: 25.61 })).toBeNull();
  });
});
