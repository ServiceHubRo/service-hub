import { describe, expect, it } from 'vitest';
import { NAV, homeOf, roleFromParam } from '../../src/app/roles';
import { translate } from '../../src/i18n/translate';

const labels = (role: keyof typeof NAV) => NAV[role].bottomBar.map((i) => translate('ro', i.labelKey));

describe('navigation per role (CLAUDE.md §1)', () => {
  it('client has exactly its five items', () => {
    expect(labels('client')).toEqual(['Caută', 'Garaj', 'Programări', 'Mesaje', 'Cont']);
  });
  it('shop has exactly its five items, no garage', () => {
    expect(labels('shop')).toEqual(['Panou', 'Programări', 'Istoric', 'Mesaje', 'Cont']);
  });
  it('admin has exactly its five items', () => {
    expect(labels('admin')).toEqual(['Prezentare', 'Service-uri', 'Clienți', 'Rezervări', 'Moderare']);
  });
  it('every route stays under its role prefix', () => {
    for (const nav of Object.values(NAV)) {
      for (const item of [...nav.main, nav.account]) expect(item.path.startsWith(`${nav.base}/`)).toBe(true);
    }
  });
  it('maps the test switch values', () => {
    expect(roleFromParam('service')).toBe('shop');
    expect(roleFromParam('client')).toBe('client');
    expect(roleFromParam('admin')).toBe('admin');
    expect(roleFromParam('root')).toBeNull();
    expect(homeOf('shop')).toBe('/s/panou');
  });
});
