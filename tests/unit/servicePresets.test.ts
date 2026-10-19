import { describe, expect, it } from 'vitest';
import catalog from '../../docs/service-catalog.json';
import { en } from '../../src/i18n/en';
import { ro } from '../../src/i18n/ro';
import { SERVICE_PRESETS } from '../../src/lib/servicePresets';

const ids = new Set(catalog.services.map((s) => s.id));

describe('kinds of workshop', () => {
  it('tick only services of the catalog, each once', () => {
    for (const preset of SERVICE_PRESETS) {
      expect(preset.services.filter((id) => !ids.has(id)), preset.key).toEqual([]);
      expect(new Set(preset.services).size, preset.key).toBe(preset.services.length);
    }
  });

  it('have distinct keys and a name in Romanian and English', () => {
    const keys = SERVICE_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(ro[`services.preset.${key}`]).toBeTruthy();
      expect(en[`services.preset.${key}`]).toBeTruthy();
    }
  });
});
