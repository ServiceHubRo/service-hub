import { describe, expect, it } from 'vitest';
import { NAV, homeOf, isStaff } from '../../src/app/roles';
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
    // Platformă: 7 at A1, plus Echipa de suport (A2); Suport: Solicitări and Păstrare legală (A3c2a).
    expect(NAV.admin.main.map((z) => z.children?.length ?? 0)).toEqual([0, 5, 6, 2, 8]);
  });
  it('support agent (A2): its requests, the search and its own Cont; Help Center and Proceduri come later', () => {
    expect(labels('support')).toEqual(['Solicitări', 'Căutare', 'Cont']);
    expect(NAV.support.base).toBe('/suport');
  });
  it('the team (admin and agents) never gets a client\'s or a shop\'s screens', () => {
    expect(['client', 'shop', 'admin', 'support'].filter((r) => isStaff(r))).toEqual(['admin', 'support']);
    expect(isStaff(null)).toBe(false);
    expect(isStaff('Support')).toBe(false);
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
    expect(homeOf('support')).toBe('/suport/solicitari');
  });
});
