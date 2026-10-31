import { describe, expect, it } from 'vitest';
import {
  approvalDecision,
  extraColleagues,
  memberCan,
  monthlyTotal,
  filterJobs,
  jobGroup,
  jobShops,
  NO_JOB_FILTER,
  sortJobs,
  averagePerVehicle,
  budgetUsage,
  buildLedger,
  can,
  FLEET_CAPABILITIES,
  FLEET_ROLES,
  categoryOfService,
  costPerKm,
  costsCsv,
  documentStates,
  filterCosts,
  filterVehicles,
  fleetCostPerKm,
  fleetKpis,
  jobStage,
  lastMonths,
  monthlyTotals,
  NO_FILTER,
  partsAndLabor,
  readingsOf,
  recentActivity,
  hasFeature,
  offeredFeatures,
  trialDaysLeft,
  trialUsed,
  planState,
  overLimit,
  scopeFor,
  sortVehicles,
  sumAmounts,
  totalsBy,
  vehicleRows,
  vehicleStatus,
  vehiclesInRange,
  type FleetExpense,
  type FleetJob,
  type FleetOverview,
  type FleetQuoteItem,
  type FleetVehicle,
} from '../../src/lib/fleet';
import { sampleFleet } from '../../src/screens/fleet/sample';

const NOW = new Date('2026-10-31T10:00:00Z');

function vehicle(id: string, over: Partial<FleetVehicle> = {}): FleetVehicle {
  return {
    id,
    make: 'Dacia',
    model: 'Logan',
    year: 2020,
    plate: `B ${id} ABC`,
    vin: null,
    itp_expiry: null,
    rca_expiry: null,
    vignette_expiry: null,
    created_at: '2026-01-10T08:00:00Z',
    archived_at: null,
    unavailable: false,
    driver_id: null,
    department: null,
    vehicle_type: null,
    ...over,
  };
}

function job(id: string, over: Partial<FleetJob> = {}): FleetJob {
  return {
    id,
    ref: `P-${id}`,
    vehicle_id: 'v1',
    status: 'done',
    date: '2026-10-10',
    slot: '09:00',
    created_at: '2026-10-01T08:00:00Z',
    done_at: '2026-10-10T15:00:00Z',
    shop_id: 's1',
    shop_name: 'Auto Test',
    shop_city: 'Brașov',
    service_category: 'cat_fra',
    service_name_ro: 'Plăcuțe de frână',
    service_name_en: 'Brake pads',
    cost: 500,
    odometer: 100_000,
    work: null,
    warranty_until: null,
    quote: null,
    ...over,
  };
}

function expense(id: string, over: Partial<FleetExpense> = {}): FleetExpense {
  return {
    id,
    vehicle_id: 'v1',
    category: 'fuel',
    day: '2026-10-15',
    amount: 300,
    currency: 'RON',
    description: null,
    supplier: 'Petrom',
    odometer: null,
    booking_id: null,
    created_at: '2026-10-15T12:00:00Z',
    created_by: 'm1',
    deleted_at: null,
    ...over,
  };
}

describe('fleet permissions', () => {
  it('gives the admin everything and the driver no money', () => {
    expect(can('admin', 'members.manage')).toBe(true);
    expect(can('driver', 'costs.view')).toBe(false);
    expect(can('driver', 'quotes.approve')).toBe(false);
    expect(can('driver', 'issues.report')).toBe(true);
  });

  it('lets the accountant see money but not approve or book', () => {
    expect(can('accountant', 'costs.view')).toBe(true);
    expect(can('accountant', 'reports.view')).toBe(true);
    expect(can('accountant', 'quotes.approve')).toBe(false);
    expect(can('accountant', 'bookings.create')).toBe(false);
  });

  it('applies the manager limit and refuses everyone else', () => {
    expect(approvalDecision('admin', 99_999, 1000)).toBe('allowed');
    expect(approvalDecision('manager', 1000, 1000)).toBe('allowed');
    expect(approvalDecision('manager', 1000.01, 1000)).toBe('over_limit');
    expect(approvalDecision('manager', 50_000, null)).toBe('allowed');
    expect(approvalDecision('driver', 1, null)).toBe('not_allowed');
    expect(approvalDecision('accountant', 1, null)).toBe('not_allowed');
  });
});

describe('fleet ledger', () => {
  it('counts a done job once, for its final cost, and never an estimate or an approval', () => {
    const jobs = [
      job('a'),
      job('b', { status: 'quote_sent', cost: null, done_at: null }),
      job('c', { status: 'approved', cost: null, done_at: null }),
      job('d', { status: 'in_progress', cost: null, done_at: null }),
    ];
    const { entries } = buildLedger(jobs, []);
    expect(entries.map((e) => e.id)).toEqual(['job:a']);
    expect(entries[0]).toMatchObject({ source: 'service', amount: 500, day: '2026-10-10', category: 'repairs' });
  });

  it('counts the inspection fee of a refused quote', () => {
    const { entries } = buildLedger([job('r', { status: 'quote_refused', cost: 80, done_at: null, date: '2026-10-05' })], []);
    expect(entries[0]).toMatchObject({ amount: 80, fee: true, day: '2026-10-05', category: 'repairs' });
  });

  it('dates a job on the day it was finished in Bucharest', () => {
    // 22:30 UTC on Oct 10 is already Oct 11 in Bucharest.
    const { entries } = buildLedger([job('a', { done_at: '2026-10-10T22:30:00Z' })], []);
    expect(entries[0]!.day).toBe('2026-10-11');
  });

  it('leaves out a manual expense for a job already counted, and foreign currencies', () => {
    const { entries, duplicates, foreign } = buildLedger(
      [job('a')],
      [expense('x', { booking_id: 'a', category: 'repairs', amount: 500 }), expense('y', { currency: 'EUR' }), expense('z')],
    );
    expect(sumAmounts(entries)).toBe(800);
    expect(duplicates.map((e) => e.id)).toEqual(['x']);
    expect(foreign.map((e) => e.id)).toEqual(['y']);
  });

  it('ignores deleted expenses', () => {
    const { entries } = buildLedger([], [expense('z', { deleted_at: '2026-10-20T00:00:00Z' })]);
    expect(entries).toEqual([]);
  });

  it('maps catalog categories to fleet categories', () => {
    expect(categoryOfService('cat_rev')).toBe('maintenance');
    expect(categoryOfService('cat_anv')).toBe('tires');
    expect(categoryOfService('cat_itp')).toBe('itp');
    expect(categoryOfService('cat_mot')).toBe('repairs');
  });

  it('sums in bani', () => {
    expect(sumAmounts([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
  });
});

describe('fleet totals', () => {
  const { entries } = buildLedger(
    [job('a', { vehicle_id: 'v1', cost: 500 }), job('b', { vehicle_id: 'v2', cost: 1200, shop_id: 's2', shop_name: 'B', done_at: '2026-09-03T10:00:00Z' })],
    [expense('e1', { vehicle_id: 'v1', amount: 300 }), expense('e2', { vehicle_id: 'v2', amount: 100, category: 'tolls', day: '2025-12-20' })],
  );

  it('filters by range, vehicle, category, shop and source', () => {
    expect(sumAmounts(filterCosts(entries, { range: { from: '2026-10-01', to: '2026-10-31' } }))).toBe(800);
    expect(sumAmounts(filterCosts(entries, { vehicleIds: ['v2'] }))).toBe(1300);
    expect(sumAmounts(filterCosts(entries, { categories: ['fuel'] }))).toBe(300);
    expect(sumAmounts(filterCosts(entries, { shopIds: ['s2'] }))).toBe(1200);
    expect(sumAmounts(filterCosts(entries, { source: 'manual' }))).toBe(400);
  });

  it('groups by vehicle and category, largest first', () => {
    expect(totalsBy(entries, (e) => e.vehicle_id)).toEqual([
      { key: 'v2', total: 1300, count: 2 },
      { key: 'v1', total: 800, count: 2 },
    ]);
    expect(totalsBy(entries, (e) => e.shop_id).map((g) => g.key)).toEqual(['s2', 's1']);
  });

  it('gives the last months and their totals', () => {
    expect(lastMonths('2026-02-14', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthlyTotals(entries, ['2025-12', '2026-09', '2026-10'])).toEqual([
      { month: '2025-12', total: 100 },
      { month: '2026-09', total: 1200 },
      { month: '2026-10', total: 800 },
    ]);
  });

  it('divides by the cars in the fleet during the range', () => {
    const cars = [
      vehicle('v1'),
      vehicle('v2'),
      vehicle('v3', { archived_at: '2025-06-01T00:00:00Z' }),
      vehicle('v4', { created_at: '2026-11-15T00:00:00Z' }),
    ];
    const range = { from: '2026-01-01', to: '2026-10-31' };
    expect(vehiclesInRange(cars, range).map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(averagePerVehicle(entries, cars, range)).toBe(1000);
    expect(averagePerVehicle(entries, [], range)).toBeNull();
  });
});

describe('fleet budget', () => {
  it('is null without a budget', () => {
    expect(budgetUsage(null, 500)).toBeNull();
    expect(budgetUsage(0, 500)).toBeNull();
  });

  it('gives the remaining amount and how far over', () => {
    expect(budgetUsage(1000, 400)).toEqual({ budget: 1000, spent: 400, remaining: 600, used: 0.4, over: 0 });
    const over = budgetUsage(1000, 1250)!;
    expect(over.remaining).toBe(0);
    expect(over.over).toBeCloseTo(0.25);
  });
});

describe('cost per kilometre', () => {
  const range = { from: '2026-07-01', to: '2026-10-31' };

  it('divides the costs after the baseline by the distance', () => {
    const readings = [
      { day: '2026-06-20', km: 90_000 },
      { day: '2026-10-10', km: 100_000 },
    ];
    const { entries } = buildLedger([job('a', { cost: 500 })], [expense('e', { day: '2026-08-01', amount: 1500 }), expense('late', { day: '2026-10-20' })]);
    const r = costPerKm(readings, entries, range);
    // 500 + 1500, the expense after the last reading is not counted; 10 000 km.
    expect(r).toMatchObject({ status: 'ok', km: 10_000, cost: 2000, perKm: 0.2 });
  });

  it('refuses a figure when the data cannot support one', () => {
    expect(costPerKm([], [], range).status).toBe('no_readings');
    expect(costPerKm([{ day: '2026-08-01', km: 50_000 }], [], range).status).toBe('one_reading');
    expect(
      costPerKm(
        [
          { day: '2026-08-01', km: 50_000 },
          { day: '2026-09-01', km: 40_000 },
        ],
        [],
        range,
      ).status,
    ).toBe('inconsistent');
    expect(
      costPerKm(
        [
          { day: '2026-08-01', km: 50_000 },
          { day: '2026-09-01', km: 50_000 },
        ],
        [],
        range,
      ).status,
    ).toBe('no_distance');
  });

  it('reads odometers from done jobs and expenses only', () => {
    const readings = readingsOf(
      'v1',
      [job('a', { odometer: 100_000 }), job('b', { status: 'in_progress', odometer: 120_000, done_at: null }), job('c', { vehicle_id: 'v2' })],
      [expense('e', { odometer: 101_500, day: '2026-10-20' })],
    );
    expect(readings).toEqual([
      { day: '2026-10-10', km: 100_000 },
      { day: '2026-10-20', km: 101_500 },
    ]);
  });

  it('sums the fleet over the cars with a valid figure only', () => {
    const jobs = [
      job('a', { vehicle_id: 'v1', odometer: 10_000, cost: 100, done_at: '2026-07-05T10:00:00Z' }),
      job('b', { vehicle_id: 'v1', odometer: 12_000, cost: 300, done_at: '2026-10-05T10:00:00Z' }),
      job('c', { vehicle_id: 'v2', odometer: 5_000, cost: 900 }),
    ];
    const { entries } = buildLedger(jobs, []);
    const r = fleetCostPerKm(['v1', 'v2'], jobs, [], entries, range);
    expect(r.total).toEqual({ km: 2000, cost: 300, perKm: 0.15 });
    expect(r.perVehicle.find((p) => p.vehicle_id === 'v2')!.result.status).toBe('one_reading');
  });
});

describe('fleet vehicles', () => {
  it('derives the status from bookings and explicit marks only', () => {
    const v = vehicle('v1');
    expect(vehicleStatus(v, [])).toBe('active');
    expect(vehicleStatus(v, [job('a', { status: 'confirmed' })])).toBe('scheduled');
    expect(vehicleStatus(v, [job('a', { status: 'confirmed' }), job('b', { status: 'quote_sent' })])).toBe('in_service');
    expect(vehicleStatus({ ...v, unavailable: true }, [])).toBe('unavailable');
    expect(vehicleStatus({ ...v, archived_at: '2026-10-01T00:00:00Z' }, [job('b', { status: 'quote_sent' })])).toBe('archived');
  });

  it('searches plate with or without spaces, make, model and VIN; hides archived by default', () => {
    const cars = [
      vehicle('1', { plate: 'BV 12 ABC', make: 'Škoda', model: 'Octavia', vin: 'TMBJJ7NE0L0123456' }),
      vehicle('2', { plate: 'B 99 XYZ', make: 'Ford', model: 'Transit' }),
      vehicle('3', { plate: 'CJ 01 OLD', archived_at: '2026-01-01T00:00:00Z' }),
    ];
    const rows = vehicleRows(cars, [], null, { from: null, to: '2026-10-31' });
    const plates = (q: string) => filterVehicles(rows, { ...NO_FILTER, query: q }).map((r) => r.vehicle.id);
    expect(plates('bv12abc')).toEqual(['1']);
    expect(plates('skoda')).toEqual(['1']);
    expect(plates('TMBJJ7')).toEqual(['1']);
    expect(plates('')).toEqual(['1', '2']);
    expect(filterVehicles(rows, { ...NO_FILTER, status: 'archived' }).map((r) => r.vehicle.id)).toEqual(['3']);
  });

  it('sorts with missing values last', () => {
    const cars = [vehicle('1', { plate: 'B 2' }), vehicle('2', { plate: 'B 1' }), vehicle('3', { plate: 'B 3' })];
    const jobs = [job('a', { vehicle_id: '1', odometer: 50_000 }), job('b', { vehicle_id: '3', odometer: 90_000 })];
    const { entries } = buildLedger(jobs, []);
    const rows = vehicleRows(cars, jobs, entries, { from: null, to: '2026-10-31' });
    expect(sortVehicles(rows, 'plate').map((r) => r.vehicle.id)).toEqual(['2', '1', '3']);
    expect(sortVehicles(rows, 'odometer').map((r) => r.vehicle.id)).toEqual(['3', '1', '2']);
  });

  it('lists documents most urgent first and missing dates last', () => {
    const docs = documentStates([vehicle('1', { itp_expiry: '2026-11-05', rca_expiry: '2026-10-20' })], NOW);
    expect(docs.map((d) => [d.doc, d.urgency])).toEqual([
      ['rca', 'expired'],
      ['itp', 'soon'],
      ['vignette', 'missing'],
    ]);
  });
});

describe('fleet overview', () => {
  function data(role: FleetOverview['me']['role']): FleetOverview {
    return {
      company: { id: 'c', name: 'Firma', vat_id: null, plan_key: 'fleet_start', manager_approval_limit: 2000, budget: { monthly: 1000, yearly: null } },
      me: { member_id: 'm1', role },
      vehicles: [vehicle('v1'), vehicle('v2', { archived_at: '2026-05-01T00:00:00Z' })],
      jobs: [
        job('a', {
          cost: 500,
          quote: { id: 'q', version: 1, status: 'accepted', note: null, inspection_fee: 0, expires_at: null, total_sent: 520, total_approved: 500, sent_at: '2026-10-08T10:00:00Z', decided_at: '2026-10-08T12:00:00Z', decided_by_member: 'm1', items: [] },
        }),
        job('b', { status: 'quote_sent', cost: null, done_at: null, date: '2026-10-29' }),
      ],
      expenses: [expense('e1', { amount: 700 })],
      members: [],
      issues: [],
    };
  }

  it('computes the headline figures', () => {
    const k = fleetKpis(data('admin'), NOW);
    expect(k).toMatchObject({ vehicles: 1, inService: 1, active: 0, quotesWaiting: 1, monthSpend: 1200, yearBudget: null });
    expect(k.monthBudget).toMatchObject({ budget: 1000, spent: 1200, remaining: 0 });
  });

  it('holds no money for a driver', () => {
    const k = fleetKpis(data('driver'), NOW);
    expect(k.monthSpend).toBeNull();
    expect(k.avgPerVehicle).toBeNull();
    expect(k.monthBudget).toBeNull();
    const feed = recentActivity(data('driver'));
    expect(feed.every((a) => a.amount === null)).toBe(true);
    expect(feed.some((a) => a.kind === 'expense_added')).toBe(false);
  });

  it('lists recent activity newest first, with amounts for the admin', () => {
    const feed = recentActivity(data('admin'));
    expect(feed[0]!.kind).toBe('expense_added');
    expect(feed.find((a) => a.kind === 'quote_approved')!.amount).toBe(500);
  });

  it('separates estimate, approval and final cost', () => {
    expect(jobStage(job('a', { status: 'quote_sent' }))).toBe('estimate');
    expect(jobStage(job('a', { status: 'approved' }))).toBe('approved');
    expect(jobStage(job('a', { status: 'done' }))).toBe('final');
  });

  it('splits parts and labor only from approved typed lines', () => {
    const q = (items: FleetQuoteItem[]) => ({
      id: 'q',
      version: 1,
      status: 'accepted' as const,
      note: null,
      inspection_fee: 0,
      expires_at: null,
      total_sent: 0,
      total_approved: 0,
      sent_at: '',
      decided_at: null,
      decided_by_member: null,
      items,
    });
    expect(
      partsAndLabor(
        job('a', {
          quote: q([
            { id: '1', position: 0, name: 'Plăcuțe', price: 200, kind: 'part', approved: true },
            { id: '2', position: 1, name: 'Manoperă', price: 150, kind: 'labor', approved: true },
            { id: '3', position: 2, name: 'Discuri', price: 400, kind: 'part', approved: false },
          ]),
        }),
      ),
    ).toEqual({ parts: 200, labor: 150, other: 0 });
    expect(partsAndLabor(job('a', { quote: q([{ id: '1', position: 0, name: 'X', price: 1, kind: null, approved: true }]) }))).toBeNull();
  });
});

describe('fleet CSV', () => {
  it('writes the rows in the interface language', () => {
    const { entries } = buildLedger([job('a', { cost: 1250.5 })], []);
    const csv = costsCsv(entries, 'ro', {
      header: ['Data', 'Vehicul', 'Categorie', 'Sursă', 'Furnizor', 'Km', 'Sumă'],
      vehicle: () => 'B 1 ABC',
      category: () => 'Reparații',
      source: () => 'Service-Hub',
    });
    expect(csv).toBe('﻿Data;Vehicul;Categorie;Sursă;Furnizor;Km;Sumă\r\n2026-10-10;B 1 ABC;Reparații;Service-Hub;Auto Test;100000;1250,50\r\n');
  });
});

describe('fleet scope (what the company read answers each role)', () => {
  const full = sampleFleet(NOW);

  it('gives a driver only the assigned cars, without any amount', () => {
    const d = scopeFor(full, 'driver', 'm3');
    expect(d.vehicles.map((v) => v.id)).toEqual(['v1']);
    expect(d.jobs.every((j) => j.vehicle_id === 'v1' && j.cost === null)).toBe(true);
    expect(d.jobs.flatMap((j) => j.quote?.items ?? []).every((i) => i.price === 0)).toBe(true);
    expect(d.expenses).toEqual([]);
    expect(d.members.map((m) => m.id)).toEqual(['m3']);
    expect(d.company.budget).toEqual({ monthly: null, yearly: null });
    expect(fleetKpis(d, NOW).monthSpend).toBeNull();
  });

  it('gives the accountant and the manager the whole fleet', () => {
    expect(scopeFor(full, 'accountant', 'm6').vehicles).toHaveLength(full.vehicles.length);
    expect(scopeFor(full, 'manager', 'm2').expenses).toHaveLength(full.expenses.length);
  });

  it('counts the sample once: the typed-in invoice of a Service-Hub job and the EUR toll stay out', () => {
    const ledger = buildLedger(full.jobs, full.expenses);
    expect(ledger.duplicates.map((e) => e.id)).toEqual(['e9']);
    expect(ledger.foreign.map((e) => e.id)).toEqual(['e10']);
    expect(ledger.entries.filter((e) => e.booking_id === 'j3')).toHaveLength(1);
  });
});

describe('fleet rights in the database', () => {
  /** The arrays of `fleet_role_can` in the newest migration that (re)defines it, per role. */
  function sqlMatrix(): Record<string, string[] | 'all'> {
    const files = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
    const marker = /create (or replace )?function public\.fleet_role_can\(/;
    const name = Object.keys(files)
      .sort()
      .filter((f) => marker.test(files[f] as string))
      .pop()!;
    const sql = files[name] as string;
    const from = sql.search(marker);
    const body = sql.slice(from, sql.indexOf('$$;', from));
    const out: Record<string, string[] | 'all'> = {};
    for (const m of body.matchAll(/when '([a-z]+)' then (true|p_capability = any \(array\[([^\]]*)\]\))/g)) {
      out[m[1]!] = m[2] === 'true' ? 'all' : [...m[3]!.matchAll(/'([a-zA-Z.]+)'/g)].map((x) => x[1]!);
    }
    return out;
  }

  it('equals src/lib/fleet/permissions.ts for every role and capability', () => {
    const matrix = sqlMatrix();
    expect(Object.keys(matrix).sort()).toEqual([...FLEET_ROLES].sort());
    for (const role of FLEET_ROLES) {
      for (const c of FLEET_CAPABILITIES) {
        const inSql = matrix[role] === 'all' || (matrix[role] as string[]).includes(c);
        expect(inSql, `${role} ${c}`).toBe(can(role, c));
      }
      if (matrix[role] !== 'all') for (const c of matrix[role] as string[]) expect(FLEET_CAPABILITIES, `${role}: ${c} exists`).toContain(c);
    }
  });
});

describe('fleet plans', () => {
  const plan = { features: ['dashboard', 'vehicles', 'reports', 'approval_flow'] };

  it('gates features; the preview (no plan) shows everything', () => {
    expect(hasFeature(plan, 'reports')).toBe(true);
    expect(hasFeature(plan, 'budget')).toBe(false);
    expect(hasFeature(null, 'budget')).toBe(true);
  });

  it('never offers a feature that is not built', () => {
    expect(offeredFeatures(plan.features)).toEqual(['dashboard', 'vehicles', 'reports']);
  });

  it('counts the trial in Bucharest days', () => {
    expect(trialDaysLeft('2026-11-30T10:00:00Z', NOW)).toBe(30);
    expect(trialDaysLeft('2026-10-30T10:00:00Z', NOW)).toBe(0);
    expect(trialDaysLeft(null, NOW)).toBeNull();
    expect(trialUsed('2026-10-01T10:00:00Z', '2026-10-31T10:00:00Z', new Date('2026-10-16T10:00:00Z'))).toBeCloseTo(0.5);
  });

  it('names the state and how far over a limit', () => {
    expect(planState({ status: 'trial', trial_ends_at: '2026-11-30T10:00:00Z' }, NOW)).toBe('trial');
    expect(planState({ status: 'trial', trial_ends_at: '2026-10-30T10:00:00Z' }, NOW)).toBe('trial_over');
    expect(planState({ status: 'active', trial_ends_at: null }, NOW)).toBe('active');
    expect(overLimit(18, 15)).toBe(3);
    expect(overLimit(4, 15)).toBe(0);
    expect(overLimit(400, null)).toBe(0);
  });
});

describe('fleet bookings (Programări)', () => {
  const jobs = [
    job('done1', { status: 'done', date: '2026-10-01', slot: '09:00' }),
    job('pend', { status: 'pending', date: '2026-11-10', slot: '10:00', shop_id: 's2', shop_name: 'Atelier Doi', shop_city: 'Codlea' }),
    job('quote', { status: 'quote_sent', date: '2026-11-02', slot: '09:00', vehicle_id: 'v2' }),
    job('conf', { status: 'confirmed', date: '2026-11-03', slot: '08:00' }),
    job('canc', { status: 'cancelled', date: '2026-10-20', slot: '09:00' }),
  ];

  it('groups a booking: a waiting quote, still going on, or ended', () => {
    expect(jobGroup({ status: 'quote_sent' })).toBe('approve');
    expect(jobGroup({ status: 'in_progress' })).toBe('active');
    expect(jobGroup({ status: 'quote_refused' })).toBe('ended');
  });

  it('puts the quotes to approve first, then what is going on soonest first, then what ended newest first', () => {
    expect(sortJobs(jobs).map((j) => j.id)).toEqual(['quote', 'conf', 'pend', 'canc', 'done1']);
  });

  it('filters by group, vehicle and shop', () => {
    expect(filterJobs(jobs, { ...NO_JOB_FILTER, group: 'approve' }).map((j) => j.id)).toEqual(['quote']);
    expect(filterJobs(jobs, { ...NO_JOB_FILTER, group: 'ended' }).map((j) => j.id)).toEqual(['done1', 'canc']);
    expect(filterJobs(jobs, { ...NO_JOB_FILTER, vehicleId: 'v2' }).map((j) => j.id)).toEqual(['quote']);
    expect(filterJobs(jobs, { ...NO_JOB_FILTER, shopId: 's2' }).map((j) => j.id)).toEqual(['pend']);
    expect(filterJobs(jobs, NO_JOB_FILTER)).toHaveLength(5);
  });

  it('lists each shop once, by name', () => {
    expect(jobShops(jobs).map((s) => s.id)).toHaveLength(2);
    expect(jobShops(jobs).find((s) => s.id === 's2')?.name).toBe('Atelier Doi, Codlea');
  });

  it('lets a driver book (the database limits it to the vehicle assigned)', () => {
    expect(can('driver', 'bookings.create')).toBe(true);
    expect(can('accountant', 'bookings.create')).toBe(false);
    expect(can('driver', 'quotes.approve')).toBe(false);
  });
});

describe('rights the admin gives (T63i)', () => {
  it('adds a right to the role, with what it needs to be used', () => {
    expect(memberCan('accountant', [], 'quotes.approve')).toBe(false);
    expect(memberCan('accountant', ['quotes.approve'], 'quotes.approve')).toBe(true);
    expect(memberCan('driver', ['quotes.approve'], 'bookings.viewAll')).toBe(true);
    expect(memberCan('driver', ['quotes.approve'], 'costs.view')).toBe(true);
    expect(memberCan('driver', ['vehicles.manage'], 'vehicles.viewAll')).toBe(true);
    expect(memberCan('driver', ['vehicles.manage'], 'costs.view')).toBe(false);
    expect(memberCan('manager', ['budget.manage'], 'budget.manage')).toBe(true);
    // Never the admin's part.
    expect(memberCan('manager', ['members.manage'], 'subscription.manage')).toBe(false);
    expect(memberCan('manager', ['members.manage'], 'company.manage')).toBe(false);
  });

  it('approves up to the member\'s own limit, else the company\'s', () => {
    expect(approvalDecision('accountant', 250, 300, ['quotes.approve'])).toBe('allowed');
    expect(approvalDecision('accountant', 400, 300, ['quotes.approve'])).toBe('over_limit');
    expect(approvalDecision('accountant', 100, null, [])).toBe('not_allowed');
    expect(approvalDecision('manager', 1000, null)).toBe('allowed');
    expect(approvalDecision('admin', 1_000_000, 10)).toBe('allowed');
  });
});

describe('colleagues billed per person (T64d)', () => {
  it('counts the colleagues past the included ones', () => {
    expect(extraColleagues(4, 3)).toBe(1);
    expect(extraColleagues(2, 3)).toBe(0);
    expect(extraColleagues(9, null)).toBe(0);
  });

  it('adds each one to the plan\'s price; nothing for a price agreed per company', () => {
    expect(monthlyTotal(59, 19, 4, 3)).toBe(78);
    expect(monthlyTotal(29, 19, 1, 1)).toBe(29);
    expect(monthlyTotal(119, 19, 8, 5)).toBe(176);
    expect(monthlyTotal(null, 19, 8, 5)).toBeNull();
  });
});

describe('the rights line of a member', () => {
  it('names only the rights the role does not have, with the limit', async () => {
    const { rightsSummary, ticksFor } = await import('../../src/screens/client/companies/rights');
    expect(ticksFor('manager').map((x) => x.key)).toEqual(['budget', 'members']);
    expect(rightsSummary('ro', 'accountant', ['quotes.approve'], 300)).toBe('Aprobă devize până la 300 lei');
    expect(rightsSummary('en', 'driver', ['vehicles.manage', 'costs.view', 'reports.view'], null)).toBe('Adds and edits vehicles · Sees costs and reports');
    expect(rightsSummary('ro', 'manager', [], 500)).toBe('Limita lui: 500 lei');
    expect(rightsSummary('ro', 'driver', [], null)).toBe('');
  });
});
