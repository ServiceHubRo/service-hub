import { ymdInBucharest } from '../../i18n/format';
import type { FleetExpense, FleetJob, FleetOverview, FleetPlanRow, FleetPlanSummary, FleetQuote, FleetSubscriptionView, FleetVehicle } from '../../lib/fleet';

/**
 * SAMPLE DATA for the design preview (`/dev/flota`, test builds only). Invented company, cars, shops
 * and amounts, dated relative to today so the charts always have a current year. Never used by a
 * real screen: the real fleet screens read `fleet_overview()` (docs/FLEET_PLAN.md §3.3).
 */

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const at = (ymd: string, hour = 10) => `${ymd}T${String(hour - 2).padStart(2, '0')}:00:00Z`;

export function sampleFleet(now: Date = new Date()): FleetOverview {
  const today = ymdInBucharest(now);
  const ago = (days: number) => addDays(today, -days);

  const vehicles: FleetVehicle[] = [
    car('v1', 'Dacia', 'Logan', 2021, 'B 101 FLT', 'UU1LSDAAH12345678', ago(400), { driver_id: 'm3', department: 'Vânzări', vehicle_type: 'car', itp: 160, rca: 12, vignette: 70 }),
    car('v2', 'Ford', 'Transit Custom', 2019, 'B 202 FLT', 'WF0YXXTTGYKA12345', ago(400), { driver_id: 'm4', department: 'Logistică', vehicle_type: 'van', itp: 20, rca: 210, vignette: -3 }),
    car('v3', 'Škoda', 'Octavia', 2022, 'B 303 FLT', 'TMBJJ7NE0N0123456', ago(330), { driver_id: 'm5', department: 'Vânzări', vehicle_type: 'car', itp: 500, rca: 90, vignette: 140 }),
    car('v4', 'Renault', 'Master', 2018, 'B 404 FLT', null, ago(300), { driver_id: null, department: 'Logistică', vehicle_type: 'van', itp: 45, rca: null, vignette: 25 }),
    car('v5', 'Toyota', 'Corolla Hybrid', 2023, 'B 505 FLT', 'SB1Z93BE10E012345', ago(90), { driver_id: null, department: 'Management', vehicle_type: 'car', itp: 700, rca: 250, vignette: 300 }),
    car('v6', 'Opel', 'Astra', 2015, 'B 606 FLT', null, ago(500), { archived: ago(120), department: 'Vânzări', vehicle_type: 'car', itp: null, rca: null, vignette: null }),
  ];

  const jobs: FleetJob[] = [
    done('j1', 'v1', ago(320), 'cat_rev', 'Revizie completă', 'Full service', 'Auto Expert', 's1', 890, 78_400),
    done('j2', 'v1', ago(200), 'cat_fra', 'Plăcuțe de frână', 'Brake pads', 'Service Rapid', 's2', 640, 89_900, {
      items: [
        ['Plăcuțe de frână față', 380, 'part'],
        ['Manoperă', 260, 'labor'],
      ],
    }),
    done('j3', 'v1', ago(40), 'cat_anv', 'Schimb anvelope', 'Tire change', 'Auto Expert', 's1', 1_960, 101_200),
    done('j4', 'v2', ago(290), 'cat_rev', 'Revizie completă', 'Full service', 'Garaj Nord', 's3', 1_150, 142_000),
    done('j5', 'v2', ago(150), 'cat_tra', 'Kit ambreiaj', 'Clutch kit', 'Garaj Nord', 's3', 3_450, 158_300, {
      items: [
        ['Kit ambreiaj', 2_350, 'part'],
        ['Volantă', 0, 'part'],
        ['Manoperă', 1_100, 'labor'],
      ],
      warranty: 210,
    }),
    done('j6', 'v2', ago(25), 'cat_itp', 'ITP', 'Vehicle inspection', 'Service Rapid', 's2', 220, 171_900),
    done('j7', 'v3', ago(180), 'cat_rev', 'Revizie completă', 'Full service', 'Auto Expert', 's1', 980, 31_000),
    done('j8', 'v3', ago(12), 'cat_ele', 'Diagnoză electrică', 'Electrical diagnostics', 'Service Rapid', 's2', 350, 46_800),
    done('j9', 'v4', ago(240), 'cat_sus', 'Amortizoare', 'Shock absorbers', 'Garaj Nord', 's3', 2_100, 210_500),
    done('j10', 'v6', ago(260), 'cat_mot', 'Curea distribuție', 'Timing belt', 'Auto Expert', 's1', 1_700, 243_000),
    {
      ...base('j11', 'v4', today, 'cat_fra', 'Discuri și plăcuțe', 'Discs and pads', 'Service Rapid', 's2'),
      status: 'quote_sent',
      date: ago(1),
      created_at: at(ago(3)),
      quote: quote('q11', at(today, 9), null, 'sent', [
        ['Discuri frână față', 980, 'part'],
        ['Plăcuțe frână față', 420, 'part'],
        ['Manoperă', 450, 'labor'],
      ]),
    },
    {
      ...base('j12', 'v2', today, 'cat_rev', 'Schimb ulei', 'Oil change', 'Garaj Nord', 's3'),
      status: 'confirmed',
      date: addDays(today, 4),
      created_at: at(ago(2)),
    },
    {
      ...base('j13', 'v5', today, 'cat_cli', 'Igienizare climă', 'A/C cleaning', 'Auto Expert', 's1'),
      status: 'approved',
      date: ago(2),
      created_at: at(ago(6)),
      quote: quote('q13', at(ago(2), 11), at(ago(2), 15), 'accepted', [
        ['Igienizare instalație', 250, 'labor'],
        ['Filtru habitaclu', 90, 'part'],
      ]),
    },
  ];

  const expenses: FleetExpense[] = [
    exp('e1', 'v1', ago(300), 'insurance', 1_450, 'Asigurări SA', null),
    exp('e2', 'v2', ago(280), 'insurance', 2_300, 'Asigurări SA', null),
    exp('e3', 'v3', ago(200), 'insurance', 1_380, 'Asigurări SA', null),
    exp('e4', 'v2', ago(210), 'tolls', 310, 'CNAIR', null),
    exp('e5', 'v1', ago(60), 'fuel', 520, 'Stație carburant', 99_800),
    exp('e6', 'v1', ago(8), 'fuel', 480, 'Stație carburant', 103_400),
    exp('e7', 'v2', ago(15), 'fuel', 760, 'Stație carburant', 173_100),
    exp('e8', 'v3', ago(5), 'consumables', 140, 'Magazin auto', null),
    // Typed in for a job Service-Hub already counts: listed, never summed twice.
    { ...exp('e9', 'v1', ago(40), 'tires', 1_960, 'Auto Expert', null), booking_id: 'j3', description: 'Factura anvelope' },
    // Paid abroad: listed, not converted.
    { ...exp('e10', 'v2', ago(70), 'tolls', 45, 'Vignette HU', null), currency: 'EUR' },
    exp('e11', 'v4', ago(100), 'parts', 380, 'Magazin piese', 216_000),
  ];

  return {
    company: {
      id: 'c-sample',
      name: 'Transport Exemplu SRL',
      vat_id: null,
      plan_key: 'fleet_business',
      manager_approval_limit: 2_500,
      budget: { monthly: 4_000, yearly: 30_000 },
    },
    me: { member_id: 'm1', role: 'admin' },
    vehicles,
    jobs,
    expenses,
    members: [
      member('m1', 'Ana Ionescu', 'ana@exemplu.ro', 'admin'),
      member('m2', 'Mihai Pop', 'mihai@exemplu.ro', 'manager'),
      member('m3', 'Ion Marin', 'ion@exemplu.ro', 'driver'),
      member('m4', 'Elena Dinu', 'elena@exemplu.ro', 'driver'),
      member('m5', 'Radu Stan', 'radu@exemplu.ro', 'driver'),
      member('m6', 'Carmen Vasile', 'contabil@exemplu.ro', 'accountant'),
      { ...member('m7', '', 'nou@exemplu.ro', 'driver'), user_id: null, accepted_at: null },
    ],
    issues: [
      { id: 'i1', vehicle_id: 'v4', kind: 'problem', body: 'Scârțâie frânele la oprire.', status: 'scheduled', reported_by: 'm2', created_at: at(ago(4), 8), booking_id: 'j11' },
      { id: 'i2', vehicle_id: 'v1', kind: 'incident', body: 'Zgârietură pe ușa din spate, parcare client.', status: 'open', reported_by: 'm3', created_at: at(ago(1), 17), booking_id: null },
    ],
  };

  function car(
    id: string,
    make: string,
    model: string,
    year: number,
    plate: string,
    vin: string | null,
    added: string,
    o: { driver_id?: string | null; department: string; vehicle_type: string; itp: number | null; rca: number | null; vignette: number | null; archived?: string },
  ): FleetVehicle {
    const due = (d: number | null) => (d === null ? null : addDays(today, d));
    return {
      id,
      make,
      model,
      year,
      plate,
      vin,
      itp_expiry: due(o.itp),
      rca_expiry: due(o.rca),
      vignette_expiry: due(o.vignette),
      created_at: at(added),
      archived_at: o.archived ? at(o.archived) : null,
      unavailable: false,
      driver_id: o.driver_id ?? null,
      department: o.department,
      vehicle_type: o.vehicle_type,
    };
  }

  function base(id: string, vehicle: string, day: string, cat: string, ro: string, en: string, shop: string, shopId: string): FleetJob {
    return {
      id,
      ref: `P-${String(4200 + Number(id.slice(1))).padStart(6, '0')}`,
      vehicle_id: vehicle,
      status: 'done',
      date: day,
      slot: '09:00',
      created_at: at(addDays(day, -5)),
      done_at: null,
      shop_id: shopId,
      shop_name: shop,
      shop_city: 'București',
      service_category: cat,
      service_name_ro: ro,
      service_name_en: en,
      cost: null,
      odometer: null,
      work: null,
      warranty_until: null,
      quote: null,
    };
  }

  function done(
    id: string,
    vehicle: string,
    day: string,
    cat: string,
    ro: string,
    en: string,
    shop: string,
    shopId: string,
    cost: number,
    km: number,
    o: { items?: [string, number, 'part' | 'labor'][]; warranty?: number } = {},
  ): FleetJob {
    const lines = o.items ?? [[ro, cost, 'labor']];
    return {
      ...base(id, vehicle, day, cat, ro, en, shop, shopId),
      done_at: at(day, 16),
      cost,
      odometer: km,
      work: ro,
      warranty_until: o.warranty ? addDays(today, o.warranty) : null,
      quote: quote(`q${id}`, at(day, 11), at(day, 12), 'accepted', lines),
    };
  }

  function quote(id: string, sent: string, decided: string | null, status: FleetQuote['status'], lines: [string, number, 'part' | 'labor'][]): FleetQuote {
    const total = lines.reduce((s, [, p]) => s + p, 0);
    return {
      id,
      version: 1,
      status,
      total_sent: total,
      total_approved: status === 'accepted' ? total : null,
      sent_at: sent,
      decided_at: decided,
      decided_by_member: decided ? 'm2' : null,
      items: lines.map(([name, price, kind], i) => ({ id: `${id}-${i}`, name, price, kind, approved: status === 'accepted' ? true : null })),
    };
  }

  function exp(id: string, vehicle: string, day: string, category: FleetExpense['category'], amount: number, supplier: string, km: number | null): FleetExpense {
    return {
      id,
      vehicle_id: vehicle,
      category,
      day,
      amount,
      currency: 'RON',
      description: null,
      supplier,
      odometer: km,
      booking_id: null,
      created_at: at(day, 18),
      created_by: 'm6',
      deleted_at: null,
    };
  }

  function member(id: string, name: string, email: string, role: FleetOverview['me']['role']) {
    return { id, user_id: `u-${id}`, name, email, role, accepted_at: at(ago(380)) };
  }
}

/** The member the preview acts as for each role. */
export const SAMPLE_MEMBER_FOR_ROLE = { admin: 'm1', manager: 'm2', driver: 'm3', accountant: 'm6' } as const;

/** A company with nothing in it yet: what a new fleet sees. */
export function emptyFleet(): FleetOverview {
  const s = sampleFleet();
  return { ...s, company: { ...s.company, budget: { monthly: null, yearly: null } }, vehicles: [], jobs: [], expenses: [], issues: [], members: s.members.slice(0, 1) };
}

/** SAMPLE plans for the preview, as `fleet_subscription` answers them (T64a). */
const SAMPLE_PLANS: FleetPlanRow[] = [
  { key: 'fleet_start', name_ro: 'Fleet Start', name_en: 'Fleet Start', price_ron: 29, vehicle_limit: 5, member_limit: 1, features: ['dashboard', 'vehicles', 'history', 'doc_alerts', 'costs_basic'] },
  { key: 'fleet_business', name_ro: 'Fleet Business', name_en: 'Fleet Business', price_ron: 59, vehicle_limit: 15, member_limit: 10, features: ['dashboard', 'vehicles', 'history', 'doc_alerts', 'costs_basic', 'members', 'reports', 'export_csv', 'budget', 'cost_per_km'] },
  { key: 'fleet_pro', name_ro: 'Fleet Pro', name_en: 'Fleet Pro', price_ron: 119, vehicle_limit: 40, member_limit: null, features: ['dashboard', 'vehicles', 'history', 'doc_alerts', 'costs_basic', 'members', 'reports', 'export_csv', 'budget', 'cost_per_km'] },
  { key: 'enterprise', name_ro: 'Enterprise', name_en: 'Enterprise', price_ron: null, vehicle_limit: null, member_limit: null, features: ['dashboard', 'vehicles', 'history', 'doc_alerts', 'costs_basic', 'members', 'reports', 'export_csv', 'budget', 'cost_per_km'] },
];

export function sampleSubscription(now: Date = new Date(), vehicles = 5, members = 7): FleetSubscriptionView {
  const started = new Date(now.getTime() - 12 * 86_400_000).toISOString();
  const ends = new Date(now.getTime() + 18 * 86_400_000).toISOString();
  const business = SAMPLE_PLANS[1]!;
  return {
    plan: {
      plan_key: business.key,
      name_ro: business.name_ro,
      name_en: business.name_en,
      vehicle_limit: business.vehicle_limit,
      member_limit: business.member_limit,
      features: business.features,
      status: 'trial',
      ended_reason: null,
      trial_started_at: started,
      trial_ends_at: ends,
      current_period_end: null,
      cancel_at_period_end: false,
      read_only: false,
      billing_enabled: false,
      price_ron: business.price_ron,
      billing_months: 1,
    },
    usage: { vehicles, members },
    plans: SAMPLE_PLANS,
  };
}

export function samplePlanSummary(now: Date = new Date(), vehicles = 5): FleetPlanSummary {
  const plan: Partial<FleetSubscriptionView['plan']> = { ...sampleSubscription(now, vehicles).plan };
  delete plan.price_ron;
  delete plan.billing_months;
  return { ...(plan as FleetSubscriptionView['plan']), vehicles };
}
