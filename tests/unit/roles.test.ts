import { describe, expect, it } from 'vitest';
import { NAV, homeOf } from '../../src/app/roles';
import { translate } from '../../src/i18n/translate';

const labels = (role: keyof typeof NAV) => NAV[role].bottomBar.map((i) => translate('ro', i.shortLabelKey ?? i.labelKey));

describe('navigation per role (CLAUDE.md §1)', () => {
  it('client has exactly its five items', () => {
    expect(labels('client')).toEqual(['Caută', 'Garaj', 'Programări', 'Mesaje', 'Cont']);
  });
  it('shop has exactly its five items, no garage', () => {
    expect(labels('shop')).toEqual(['Panou', 'Programări', 'Istoric', 'Mesaje', 'Cont']);
  });
  it('admin has exactly its five zones (A1), each but Panou with its sub-sections', () => {
    expect(labels('admin')).toEqual(['Panou', 'Parteneri', 'Activitate', 'Suport', 'Platformă']);
    expect(NAV.admin.main.map((z) => z.children?.length ?? 0)).toEqual([0, 5, 6, 1, 7]);
  });
  it('every route stays under its role prefix', () => {
    for (const nav of Object.values(NAV)) {
      for (const item of [...nav.main, nav.account]) expect(item.path.startsWith(`${nav.base}/`)).toBe(true);
    }
  });
  it('each role has its home', () => {
    expect(homeOf('client')).toBe('/c/cauta');
    expect(homeOf('shop')).toBe('/s/panou');
    expect(homeOf('admin')).toBe('/admin/panou');
  });
});
