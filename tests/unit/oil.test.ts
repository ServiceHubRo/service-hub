import { describe, expect, it } from 'vitest';
import { formatMonthLong } from '../../src/i18n/format';
import { addMonths, lastOilChange, oilDue, type OilJob } from '../../src/lib/oil';

const job = (over: Partial<OilJob>): OilJob => ({
  car_id: 'car-1',
  status: 'done',
  service_id: 'ulei',
  extra_service_ids: [],
  done_at: '2026-03-10T09:00:00Z',
  ...over,
});

describe('the next oil change (T30)', () => {
  it('adds months like Postgres: the end of a shorter month is kept', () => {
    expect(addMonths('2026-04-20', 6)).toBe('2026-10-20');
    expect(addMonths('2026-10-20', 6)).toBe('2027-04-20');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 24)).toBe('2028-12-15');
  });

  it('counts from the newest of the Garage date and the finished oil changes or full services of the car', () => {
    const car = { id: 'car-1', last_oil_change: '2026-01-05' };
    expect(lastOilChange(car, [])).toBe('2026-01-05');
    expect(lastOilChange(car, [job({})])).toBe('2026-03-10');
    // A full service changes the oil too, also as an added service.
    expect(lastOilChange(car, [job({ service_id: 'frane', extra_service_ids: ['revizie'], done_at: '2026-05-02T08:00:00Z' })])).toBe(
      '2026-05-02',
    );
    // Not: another service, another car, a job not finished.
    expect(lastOilChange(car, [job({ service_id: 'frane' }), job({ car_id: 'car-2' }), job({ status: 'in_progress', done_at: null })])).toBe(
      '2026-01-05',
    );
    // The day in Bucharest: 22:30 UTC on 9 March is already 10 March there.
    expect(lastOilChange({ id: 'car-1', last_oil_change: null }, [job({ done_at: '2026-03-09T22:30:00Z' })])).toBe('2026-03-10');
    // A newer date written in the Garage wins.
    expect(lastOilChange({ id: 'car-1', last_oil_change: '2026-06-01' }, [job({})])).toBe('2026-06-01');
  });

  it('is unknown without a date or an interval', () => {
    expect(oilDue('2026-04-20', 6)).toBe('2026-10-20');
    expect(oilDue(null, 6)).toBeNull();
    expect(oilDue('2026-04-20', null)).toBeNull();
  });

  it('the Garage card says the month only, with the year when it is not this one', () => {
    const now = new Date('2026-10-05T09:00:00Z');
    expect(formatMonthLong('ro', '2026-10-20', now)).toBe('octombrie');
    expect(formatMonthLong('ro', '2027-01-10', now)).toBe('ianuarie 2027');
    expect(formatMonthLong('en', '2026-10-20', now)).toBe('October');
    expect(formatMonthLong('en', '2027-01-10', now)).toBe('January 2027');
  });
});
