import { describe, expect, it } from 'vitest';
import { ADMIN_ZONES, adminZoneBack, adminZoneOf } from '../../src/app/adminZones';
import { ADMIN_ACCOUNT_PATH, ADMIN_LEGACY_ROUTES, legacyAdminPath } from '../../src/screens/admin/paths';
import { translate } from '../../src/i18n/translate';

const subSections = ADMIN_ZONES.flatMap((z) => z.items);

describe('admin zones (A1)', () => {
  it('five zones, at most one level of sub-sections, every sub-section under its zone', () => {
    expect(ADMIN_ZONES.map((z) => translate('ro', z.labelKey))).toEqual(['Panou', 'Parteneri', 'Activitate', 'Suport', 'Platformă']);
    for (const zone of ADMIN_ZONES) for (const item of zone.items) expect(item.path.startsWith(`${zone.path}/`)).toBe(true);
  });

  it('every function of the inventory has exactly one place', () => {
    const paths = subSections.map((i) => i.path);
    expect(new Set(paths).size).toBe(paths.length);
    // 19 at A1, plus Echipa de suport (A2), Păstrare legală (A3c2a), Sugestii de verificat and Retenția datelor
    // (A3c2b1), Centrul de ajutor (A4).
    expect(paths.length).toBe(24);
  });

  it('Platformă splits Configurare and Control; the other zones have no groups', () => {
    const platform = ADMIN_ZONES.find((z) => z.path === '/admin/platforma')!;
    expect(platform.items.map((i) => i.group)).toEqual(['config', 'config', 'config', 'config', 'config', 'control', 'control', 'control', 'control']);
    for (const zone of ADMIN_ZONES.filter((z) => z !== platform)) expect(zone.items.every((i) => !i.group)).toBe(true);
  });

  it('a fișă belongs to the zone of its list; „‹ Înapoi” of a sub-section goes to its zone', () => {
    expect(adminZoneOf('/admin/parteneri/clienti/123')?.path).toBe('/admin/parteneri');
    expect(adminZoneOf('/admin/cont')).toBeUndefined();
    expect(adminZoneBack('/admin/platforma/texte')).toEqual({ to: '/admin/platforma', label: 'nav.admin.platform' });
  });
});

describe('the admin addresses from before A1', () => {
  it('every old address has a new one, inside a zone', () => {
    for (const [old, now] of ADMIN_LEGACY_ROUTES) {
      expect(legacyAdminPath(old)).toBe(now);
      expect(adminZoneOf(now)).toBeDefined();
    }
    // 19 at A1, plus Sugestii → Solicitări (A3a).
    expect(ADMIN_LEGACY_ROUTES.length).toBe(20);
  });

  it('fișe keep their ID, exactly as written (encoded characters included)', () => {
    expect(legacyAdminPath('/admin/clienti/5f0c1d2e-aaaa-bbbb-cccc-123456789012')).toBe('/admin/parteneri/clienti/5f0c1d2e-aaaa-bbbb-cccc-123456789012');
    expect(legacyAdminPath('/admin/service-uri/a%20b%2Fc%C8%99')).toBe('/admin/parteneri/service-uri/a%20b%2Fc%C8%99');
    expect(legacyAdminPath('/admin/rezervari/x/')).toBe('/admin/activitate/programari/x/');
  });

  it('the longest start wins; starts only match whole segments', () => {
    expect(legacyAdminPath('/admin/cont/setari/texte')).toBe('/admin/platforma/texte');
    expect(legacyAdminPath('/admin/cont/setari')).toBe('/admin/platforma/setari');
    expect(legacyAdminPath('/admin/cont/setarix')).toBeNull();
    expect(legacyAdminPath('/admin/clientix')).toBeNull();
    expect(legacyAdminPath('/admin/rezervari-vechi')).toBeNull();
  });

  it('the admin’s own account and the new addresses are not redirected', () => {
    expect(legacyAdminPath(ADMIN_ACCOUNT_PATH)).toBeNull();
    expect(legacyAdminPath('/admin/cont/legal/termeni')).toBeNull();
    for (const item of subSections) expect(legacyAdminPath(item.path)).toBeNull();
    for (const zone of ADMIN_ZONES) expect(legacyAdminPath(zone.path)).toBeNull();
  });
});
