import { describe, expect, it } from 'vitest';
import type { CompanyCheckRow } from '../../src/data/adminTools';
import { companyFilterCounts, filterCompanyChecks, isCompanyProblem } from '../../src/lib/adminTools';

const row = (over: Partial<CompanyCheckRow>): CompanyCheckRow => ({
  shop_id: over.shop_name ?? 's',
  shop_name: 'Atelier',
  city: 'Brașov',
  display_id: 'S-00001',
  state: 'active',
  vat_id: 'RO14872301',
  legal_name: 'Auto Unu SRL',
  vat_payer: true,
  anaf_status: 'active',
  anaf_name: 'AUTO UNU S.R.L.',
  anaf_address: null,
  anaf_vat_payer: true,
  anaf_name_match: true,
  anaf_checked_at: '2026-10-02T10:00:00Z',
  problem_since: null,
  deadline: null,
  hidden_at: null,
  category: 'ok',
  vat_mismatch: false,
  ...over,
});

const rows = [
  row({ shop_name: 'Atelier Unu', display_id: 'S-00001' }),
  row({ shop_name: 'Atelier Doi', display_id: 'S-00002', category: 'name_mismatch', anaf_name: 'ALTA FIRMA SRL' }),
  row({ shop_name: 'Service Trei', display_id: 'S-00003', vat_mismatch: true }),
  row({ shop_name: 'Service Patru', display_id: 'S-00004', vat_id: '160796', category: 'not_found' }),
  row({ shop_name: 'Service Cinci', display_id: 'S-00005', vat_id: null, category: 'no_cui' }),
  row({ shop_name: 'Service Sase', display_id: 'S-00006', category: 'unchecked', vat_id: 'RO18000003', anaf_status: null, hidden_at: '2026-10-02T06:00:00Z' }),
];

describe('Raport ANAF', () => {
  it('problems: gone, unknown, inactive, another name, VAT ticked otherwise than at ANAF, or out of search', () => {
    expect(rows.map(isCompanyProblem)).toEqual([false, true, true, true, false, true]);
  });

  it('each chip holds its shops', () => {
    const counts = companyFilterCounts(rows);
    expect(counts.all).toBe(6);
    expect(counts.problems).toBe(4);
    expect(counts.hidden).toBe(1);
    expect(counts.ok).toBe(2);
    expect(counts.vat_mismatch).toBe(1);
    expect(counts.not_found).toBe(1);
    expect(counts.no_cui).toBe(1);
    expect(counts.inactive).toBe(0);
  });

  it('search by name, code, CUI with or without RO, and the official name', () => {
    const names = (q: string) => filterCompanyChecks(rows, q, 'all').map((r) => r.shop_name);
    expect(names('S-00004')).toEqual(['Service Patru']);
    expect(names('160796')).toEqual(['Service Patru']);
    expect(names('14872301')).toHaveLength(3);
    expect(names('alta firma')).toEqual(['Atelier Doi']);
    expect(filterCompanyChecks(rows, 'atelier', 'problems').map((r) => r.shop_name)).toEqual(['Atelier Doi']);
  });
});
