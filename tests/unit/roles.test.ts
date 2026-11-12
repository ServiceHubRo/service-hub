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
    // Platformă: 7 at A1, plus Echipa de suport (A2), Retenția datelor (A3c2b1), Securitate and Administratori
    // (A6); Suport: Solicitări, Păstrare legală (A3c2a), Sugestii de verificat (A3c2b1), Centrul de ajutor (A4)
    // and Proceduri interne (A5).
    expect(NAV.admin.main.map((z) => z.children?.length ?? 0)).toEqual([0, 5, 6, 5, 11]);
  });
  it('support agent (A2): its requests, the search, the Help Center (A4), the procedures (A5) and its own Cont', () => {
    // Five items in the bottom bar, like every role (CLAUDE.md §1).
    expect(labels('support')).toEqual(['Solicitări', 'Căutare', 'Ajutor', 'Proceduri', 'Cont']);
    expect(NAV.support.main.map((i) => translate('ro', i.labelKey))).toEqual(['Solicitări', 'Căutare', 'Centrul de ajutor', 'Proceduri interne']);
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
