import { describe, expect, it } from 'vitest';
import type { AdminClientRow, AdminShopRow } from '../../src/data/admin';
import {
  auditChanges,
  filterClients,
  filterShops,
  isBookingStatusFilter,
  isYmd,
  reportAge,
  statusesFor,
  workingDaysBetween,
} from '../../src/lib/admin';

const shop = (over: Partial<AdminShopRow>): AdminShopRow => ({
  id: 's',
  name: 'Atelier Unu',
  city: 'Brașov',
  phone: '+40268312445',
  owner_id: 'o',
  display_id: 'S-00001',
  owner_name: 'Ion Popescu',
  email: 'owner1@test.local',
  email_verified: true,
  phone_verified: true,
  state: 'trial',
  public: true,
  subscription_status: 'trial',
  trial_ends_at: null,
  created_at: '2026-09-01T10:00:00Z',
  last_active_at: null,
  ...over,
});

const client = (over: Partial<AdminClientRow>): AdminClientRow => ({
  id: 'c',
  display_id: 'C-00001',
  name: 'Ana Marin',
  email: 'ana@test.local',
  phone: '+40723000001',
  email_verified: true,
  suspended: false,
  created_at: '2026-09-01T10:00:00Z',
  last_active_at: null,
  bookings: 2,
  active_bookings: 0,
  no_shows: 0,
  ...over,
});

describe('admin lists', () => {
  const shops = [
    shop({ id: 'a' }),
    shop({ id: 'b', name: 'Service Doi', city: 'Codlea', display_id: 'S-00002', phone: '+40723000009', phone_verified: false, state: 'inactive' }),
    shop({ id: 'c', name: 'Vechi', state: 'deleted' }),
  ];

  it('finds shops by any word, without diacritics, and by phone digits', () => {
    expect(filterShops(shops, 'brasov', 'all').map((s) => s.id)).toEqual(['a']);
    expect(filterShops(shops, 's-00002', 'all').map((s) => s.id)).toEqual(['b']);
    expect(filterShops(shops, '0268 312', 'all').map((s) => s.id)).toEqual(['a']);
    expect(filterShops(shops, '268312445', 'all').map((s) => s.id)).toEqual(['a']);
    expect(filterShops(shops, 'popescu unu', 'all').map((s) => s.id)).toEqual(['a']);
  });

  it('filters by state; deleted shops only under their own chip', () => {
    expect(filterShops(shops, '', 'all').map((s) => s.id)).toEqual(['a', 'b']);
    expect(filterShops(shops, '', 'inactive').map((s) => s.id)).toEqual(['b']);
    expect(filterShops(shops, '', 'unverified').map((s) => s.id)).toEqual(['b']);
    expect(filterShops(shops, '', 'deleted').map((s) => s.id)).toEqual(['c']);
  });

  it('filters clients', () => {
    const clients = [client({ id: 'a' }), client({ id: 'b', name: 'Bogdan', email: 'bogdan@test.local', no_shows: 3, suspended: true, email_verified: false })];
    expect(filterClients(clients, '', 'no_shows').map((c) => c.id)).toEqual(['b']);
    expect(filterClients(clients, '', 'suspended').map((c) => c.id)).toEqual(['b']);
    expect(filterClients(clients, '', 'unverified').map((c) => c.id)).toEqual(['b']);
    expect(filterClients(clients, 'ana@test', 'all').map((c) => c.id)).toEqual(['a']);
  });

  it('booking status filters', () => {
    expect(statusesFor('all')).toBeUndefined();
    expect(statusesFor('active')).toEqual(['pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress']);
    expect(statusesFor('no_show')).toEqual(['no_show']);
    expect(isBookingStatusFilter('done')).toBe(true);
    expect(isBookingStatusFilter('nope')).toBe(false);
    expect(isYmd('2026-10-14')).toBe(true);
    expect(isYmd('2026-13-40')).toBe(false);
    expect(isYmd(null)).toBe(false);
  });
});

describe('report age', () => {
  it('counts Monday to Friday only', () => {
    // 2026-09-25 is a Friday.
    expect(workingDaysBetween('2026-09-25', '2026-09-25')).toBe(0);
    expect(workingDaysBetween('2026-09-25', '2026-09-28')).toBe(1); // Sat, Sun, Mon
    expect(workingDaysBetween('2026-09-25', '2026-10-02')).toBe(5);
  });

  it('is late after 5 working days, counted in Bucharest', () => {
    // Reported Friday 23:30 in Bucharest (20:30 UTC).
    const reported = '2026-09-25T20:30:00Z';
    expect(reportAge(reported, new Date('2026-10-01T09:00:00Z'))).toEqual({ days: 6, workingDays: 4, overdue: false });
    expect(reportAge(reported, new Date('2026-10-02T09:00:00Z'))).toEqual({ days: 7, workingDays: 5, overdue: true });
  });
});

describe('audit changes', () => {
  it('lists changed values and the details apart, fiscal data under billing', () => {
    const r = auditChanges({
      before: { name: 'Atelier Unu', billing: { iban: null } },
      after: { name: 'Atelier Unu Plus', billing: { iban: 'RO49AAAA1B31007593840000' }, reason: 'Cerere proprietar' },
    });
    expect(r.changes).toEqual([
      { key: 'name', before: 'Atelier Unu', after: 'Atelier Unu Plus' },
      { key: 'billing.iban', before: null, after: 'RO49AAAA1B31007593840000' },
    ]);
    expect(r.details).toEqual([{ key: 'reason', before: undefined, after: 'Cerere proprietar' }]);
  });
});
