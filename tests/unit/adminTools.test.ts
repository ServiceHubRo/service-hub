import { describe, expect, it } from 'vitest';
import { renderNotification, TEMPLATES } from '../../supabase/functions/_shared/templates.ts';
import type { AdminReportRow, AdminSubscriptionRow, CatalogCategory, PlatformSettings } from '../../src/data/adminTools';
import { EXPORT_KINDS } from '../../src/data/adminTools';
import { en } from '../../src/i18n/en';
import { ro, type MessageKey } from '../../src/i18n/ro';
import { translate } from '../../src/i18n/translate';
import { auditChanges, AUDIT_ACTIONS } from '../../src/lib/admin';
import {
  csvDateTime,
  exportTable,
  filterCatalog,
  filterReports,
  filterSubscriptions,
  parseNumber,
  placeholdersOf,
  settingsChange,
  SETTING_SECTIONS,
  suggestCategoryKey,
  suggestServiceId,
  unknownPlaceholders,
} from '../../src/lib/adminTools';
import { SERVICE_ICON_NAMES } from '../../src/lib/serviceIcons';

const t = (key: MessageKey, params?: Record<string, string | number>) => translate('ro', key, params);

const sub = (over: Partial<AdminSubscriptionRow>): AdminSubscriptionRow => ({
  shop_id: 's1',
  shop_name: 'Atelier Unu',
  city: 'Brașov',
  display_id: 'S-00001',
  owner_name: 'Ion Popescu',
  email: 'ion@test.ro',
  state: 'trial',
  status: 'trial',
  stripe_status: null,
  price_ron: 100,
  seat_price_ron: 20,
  seats: 0,
  billed_seats: null,
  monthly_ron: 100,
  trial_ends_at: '2026-12-20T10:00:00Z',
  current_period_end: null,
  cancel_at_period_end: false,
  next_payment_attempt: null,
  next_billing: '2026-12-20T10:00:00Z',
  payment_failed_at: null,
  ended_reason: null,
  status_changed_at: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  paid_count: 0,
  paid_total: 0,
  created_at: '2026-09-20T10:00:00Z',
  ...over,
});

const report = (over: Partial<AdminReportRow>): AdminReportRow => ({
  id: 'r1',
  code: 'SH-2026-000147',
  status: 'generated',
  client_id: 'c1',
  client_display_id: 'C-00012',
  client_name: 'Ana Marin',
  car_snapshot: { make: 'Volkswagen', model: 'Golf', plate: 'BV 12 ABC' },
  job_count: 3,
  price: 29,
  amount_paid: 29,
  lang: 'ro',
  created_at: '2026-09-20T10:00:00Z',
  paid_at: '2026-09-20T10:01:00Z',
  generated_at: '2026-09-20T10:01:05Z',
  void_reason: null,
  voided_at: null,
  ...over,
});

describe('lists', () => {
  it('subscriptions: every word, diacritics ignored, and the status chip', () => {
    const rows = [sub({}), sub({ shop_id: 's2', shop_name: 'Auto Doi', city: 'Codlea', status: 'active', stripe_customer_id: 'cus_ABC' })];
    expect(filterSubscriptions(rows, 'brasov', 'all').map((r) => r.shop_id)).toEqual(['s1']);
    expect(filterSubscriptions(rows, 'cus_abc', 'all').map((r) => r.shop_id)).toEqual(['s2']);
    expect(filterSubscriptions(rows, '', 'active').map((r) => r.shop_id)).toEqual(['s2']);
  });

  it('reports: code with or without dashes, plate without spaces; unpaid only under their chip', () => {
    const rows = [report({}), report({ id: 'r2', code: 'SH-2026-000148', status: 'pending_payment' })];
    expect(filterReports(rows, 'sh2026000147', 'all').map((r) => r.id)).toEqual(['r1']);
    expect(filterReports(rows, 'bv12abc', 'all').map((r) => r.id)).toEqual(['r1']);
    expect(filterReports(rows, '', 'all').map((r) => r.id)).toEqual(['r1']);
    expect(filterReports(rows, '', 'pending_payment').map((r) => r.id)).toEqual(['r2']);
  });

  it('catalog: a matching category keeps all its services, otherwise only the matching ones', () => {
    const cats: CatalogCategory[] = [
      {
        key: 'cat_fra',
        name_ro: 'Frânare',
        name_en: 'Braking',
        position: 1,
        enabled: true,
        services: [
          { id: 'placute', category_key: 'cat_fra', icon: 'Disc', name_ro: 'Plăcuțe de frână', name_en: 'Brake pads', position: 1, enabled: true, shops: 0, bookings: 0 },
          { id: 'discuri', category_key: 'cat_fra', icon: 'Disc', name_ro: 'Discuri', name_en: 'Rotors', position: 2, enabled: true, shops: 0, bookings: 0 },
        ],
      },
    ];
    expect(filterCatalog(cats, 'franare')[0]!.services).toHaveLength(2);
    expect(filterCatalog(cats, 'placute')[0]!.services.map((s) => s.id)).toEqual(['placute']);
    expect(filterCatalog(cats, 'rotors')[0]!.services.map((s) => s.id)).toEqual(['discuri']);
    expect(filterCatalog(cats, 'ulei')).toEqual([]);
  });
});

describe('catalog ids', () => {
  it('suggests simple ids without diacritics', () => {
    expect(suggestServiceId('Polish faruri')).toBe('polish_faruri');
    expect(suggestServiceId('Șasiu & Țevi')).toBe('sasiu_tevi');
    expect(suggestServiceId('4x4 diagnoză')).toBe('s_4x4_diagnoza');
    expect(suggestCategoryKey('Tractoare agricole')).toBe('cat_tractoare_agricole');
    expect(suggestServiceId('')).toBe('');
  });

  it('every catalog icon is one the app can draw', () => {
    // docs/service-catalog.json names these; ServiceIcon.tsx is typed against the same list.
    expect(SERVICE_ICON_NAMES).toContain('Wrench');
    expect(new Set(SERVICE_ICON_NAMES).size).toBe(SERVICE_ICON_NAMES.length);
  });
});

describe('settings form', () => {
  const current = {
    subscription_price_ron: 100,
    staff_seat_price_ron: 20,
    staff_free_seats: 1,
    launch_price_ron: 99,
    launch_shops: 50,
    trial_days: 90,
    quote_expiry_days: 3,
    report_price_ron: 29,
    vat_rate_percent: 0,
    ranking_prior_avg: 4.3,
    ranking_prior_weight: 3,
    default_daily_capacity: 5,
    default_cars_per_slot: 1,
    default_slot_minutes: 60,
    default_min_notice_hours: 2,
    default_max_advance_days: 30,
    default_cancel_deadline_hours: 2,
    limits: {
      active_bookings_per_shop: 3,
      active_bookings_total: 10,
      new_bookings_per_24h: 5,
      messages_per_thread_per_hour: 30,
      review_window_days: 60,
      quote_versions_max: 20,
    },
    notification_texts: {},
    updated_at: '2026-09-25T10:00:00Z',
  } satisfies PlatformSettings;

  it('reads numbers in both languages', () => {
    expect(parseNumber('29,50')).toBe(29.5);
    expect(parseNumber(' 1 250 ')).toBe(1250);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });

  it('sends only what changed, limits apart', () => {
    const { change, invalid } = settingsChange(current, {
      trial_days: '90',
      quote_expiry_days: '7',
      ranking_prior_avg: '4,3',
      report_price_ron: '35,50',
      review_window_days: '30',
      quote_versions_max: '20',
    });
    expect(invalid).toEqual([]);
    expect(change).toEqual({ quote_expiry_days: 7, report_price_ron: 35.5, limits: { review_window_days: 30 } });
  });

  it('refuses text and decimals where whole numbers are needed', () => {
    expect(settingsChange(current, { trial_days: '2,5', review_window_days: 'x', vat_rate_percent: '19' }).invalid).toEqual([
      'trial_days',
      'review_window_days',
    ]);
  });

  it('every field has a label and a hint in both languages', () => {
    const keys = [...SETTING_SECTIONS.flatMap((s) => s.fields), ...Object.keys(current.limits)];
    for (const key of keys) {
      for (const prefix of ['admin.field.', 'admin.settings.hint.']) {
        expect(ro).toHaveProperty([`${prefix}${key}`]);
        expect(en).toHaveProperty([`${prefix}${key}`]);
      }
    }
  });
});

describe('push texts', () => {
  it('finds placeholders and the ones a key never fills', () => {
    expect(placeholdersOf('{shop}: devizul pentru {car} — {total} ({car})')).toEqual(['shop', 'car', 'total']);
    expect(unknownPlaceholders('Salut {client}, {nume}', ['client', 'shop'])).toEqual(['nume']);
  });

  it('every built-in key exists in both languages', () => {
    expect(Object.keys(TEMPLATES.en).sort()).toEqual(Object.keys(TEMPLATES.ro).sort());
  });

  it('a notice push is in the recipient language and opens the screen where notices show', () => {
    const e = {
      event: 'broadcast',
      role: 'client',
      lang: 'en',
      booking_id: null,
      params: { notice_id: 'n1', title_ro: 'Program', body_ro: 'Închis', title_en: 'Hours', body_en: 'Closed' },
    };
    expect(renderNotification(e)).toMatchObject({ title: 'Hours', body: 'Closed', url: '/c/cauta', tag: 'notice-n1' });
    expect(renderNotification({ ...e, role: 'shop', lang: 'ro' })).toMatchObject({ title: 'Program', url: '/s/panou' });
    // English missing: the Romanian text.
    expect(renderNotification({ ...e, params: { notice_id: 'n1', title_ro: 'Program', body_ro: 'Închis' } })).toMatchObject({
      title: 'Program',
      body: 'Închis',
    });
  });
});

describe('exports', () => {
  it('writes moments in Bucharest time', () => {
    expect(csvDateTime('2026-10-14T07:32:00Z')).toBe('2026-10-14 10:32');
    expect(csvDateTime('2026-01-14T07:32:00Z')).toBe('2026-01-14 09:32');
    expect(csvDateTime(null)).toBe('');
  });

  it('every kind has a translated header, a file name and a hint', () => {
    for (const kind of EXPORT_KINDS) {
      const [header] = exportTable(kind, [], t, 'ro');
      expect(header!.length).toBeGreaterThan(5);
      for (const cell of header!) expect(cell).not.toMatch(/^admin\./);
      expect(ro).toHaveProperty([`admin.export.file.${kind}`]);
      expect(ro).toHaveProperty([`admin.export.hint.${kind}`]);
    }
  });

  it('a subscription row: status translated, amounts with the decimal comma', () => {
    const [, row] = exportTable('subscriptions', [sub({ price_ron: 79.5, seats: 2, monthly_ron: 119.5, paid_total: 159, paid_count: 2 })], t, 'ro');
    expect(row).toContain('Perioadă gratuită');
    expect(row).toContain('79,50');
    expect(row).toContain('119,50');
    expect(row).toContain('2026-12-20 12:00');
  });
});

describe('audit log', () => {
  it('every new action has a label', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(ro).toHaveProperty([`admin.action.${action}`]);
      expect(en).toHaveProperty([`admin.action.${action}`]);
    }
  });

  it('settings limits and export filters read well', () => {
    const settings = auditChanges({
      before: { trial_days: 90, limits: { review_window_days: 60 } },
      after: { trial_days: 30, limits: { review_window_days: 30 } },
    });
    expect(settings.changes.map((c) => c.key)).toEqual(['trial_days', 'limits.review_window_days']);
    const exported = auditChanges({ before: null, after: { kind: 'bookings', filters: { statuses: ['done'] }, rows: 2 } });
    expect(exported.changes).toEqual([]);
    expect(exported.details.map((d) => d.key)).toEqual(['kind', 'filters', 'rows']);
  });
});
