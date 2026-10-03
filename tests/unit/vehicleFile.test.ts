import { describe, expect, it } from 'vitest';
import { lastKnownOdometer, type OwnVehicleFileJob, type VehicleFileJob } from '../../src/data/vehicleFile';

const job = (odometer: number | null): VehicleFileJob => ({
  id: String(odometer),
  date: '2026-09-01',
  service_ro: 'Schimb ulei',
  service_en: 'Oil change',
  service_icon: null,
  items: [],
  work: null,
  odometer,
});
const own = (odometer: number | null): OwnVehicleFileJob => ({ ...job(odometer), ref: 'P-1', cost: 100, client_name: 'Ana' });

describe('Fișa mașinii (T27)', () => {
  it('the last known odometer is the highest reading the shop can see, here or elsewhere', () => {
    expect(lastKnownOdometer({ own: [own(105400), own(null)], others: [job(110200)] })).toBe(110200);
    expect(lastKnownOdometer({ own: [own(98000)], others: [] })).toBe(98000);
    expect(lastKnownOdometer({ own: [own(null)], others: [] })).toBeNull();
    expect(lastKnownOdometer({ own: [], others: [] })).toBeNull();
  });
});
