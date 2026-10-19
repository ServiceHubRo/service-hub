import { ChevronDown, SearchX } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { BackLink } from '../../../components/BackLink';
import { Button } from '../../../components/Button';
import { Checkbox } from '../../../components/Checkbox';
import { Chip } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { Field } from '../../../components/Field';
import { SkeletonList } from '../../../components/Skeleton';
import { fetchCatalog, fetchShopServices, saveShopServices, type CatalogCategory } from '../../../data/shop';
import { useI18n } from '../../../i18n/context';
import { plural } from '../../../i18n/translate';
import { SERVICE_PRESETS, type ServicePresetKey } from '../../../lib/servicePresets';
import { matchesWords, searchWords } from '../../../lib/text';
import { useLoad } from '../../../lib/useLoad';
import { LoadError } from '../../../components/LoadError';
import { SETTINGS_PATH } from './paths';
import { SaveButton } from './SaveButton';
import { useShopSettings } from './shopSettingsContext';
import styles from './settings.module.css';
import own from './ServicesSettings.module.css';

interface Loaded {
  catalog: CatalogCategory[];
  selected: string[];
}

/**
 * Servicii oferite (P5): the catalog with checkboxes, search without diacritics, no prices. A kind
 * of workshop ticks its usual services in one tap; the categories open one at a time, each with
 * how many are ticked and "Toate" (Eduard, 19 Oct).
 */
export function ServicesSettings() {
  const { t } = useI18n();
  const { shop } = useShopSettings();
  const load = useCallback(async (): Promise<Loaded> => {
    const [catalog, selected] = await Promise.all([fetchCatalog(), fetchShopServices(shop.id)]);
    return { catalog, selected };
  }, [shop.id]);
  const { state, reload } = useLoad(load);

  return (
    <div className={styles.page}>
      <BackLink to={SETTINGS_PATH} label={t('settings.title')} />
      <h1>{t('settings.services')}</h1>
      <p className={styles.intro}>{t('services.intro')}</p>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('settings.loadError')} onRetry={reload} />}
      {state.status === 'ready' && <Catalog catalog={state.data.catalog} initial={state.data.selected} />}
    </div>
  );
}

function Catalog({ catalog, initial }: { catalog: CatalogCategory[]; initial: string[] }) {
  const { t, lang } = useI18n();
  const all = useMemo(() => catalog.flatMap((c) => c.services.map((s) => s.id)), [catalog]);
  // Only services still in the catalog count (a disabled one disappears on the next save).
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial.filter((id) => all.includes(id))));
  const [saved, setSaved] = useState<Set<string>>(selected);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // The kinds of workshop turned on here, each with the services it ticked (so turning it off
  // clears those and nothing the shop had ticked itself).
  const [presets, setPresets] = useState<Map<ServicePresetKey, Set<string>>>(() => new Map());
  const [presetNote, setPresetNote] = useState('');

  const name = (x: { name_ro: string; name_en: string }) => (lang === 'ro' ? x.name_ro : x.name_en);

  const searching = searchWords(query).length > 0;
  const visible = useMemo(() => {
    const words = searchWords(query);
    if (words.length === 0) return catalog;
    return catalog
      .map((c) => {
        const categoryHit = matchesWords(words, c.name_ro, c.name_en);
        return { ...c, services: categoryHit ? c.services : c.services.filter((s) => matchesWords(words, s.name_ro, s.name_en)) };
      })
      .filter((c) => c.services.length > 0);
  }, [catalog, query]);

  const visibleIds = visible.flatMap((c) => c.services.map((s) => s.id));
  const changed = selected.size !== saved.size || [...selected].some((id) => !saved.has(id));

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setMany(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function togglePreset(key: ServicePresetKey) {
    const preset = SERVICE_PRESETS.find((p) => p.key === key)!;
    const type = t(`services.preset.${key}`);
    const added = presets.get(key);
    if (added) {
      // Off: what it ticked goes, unless another kind still turned on ticked it too.
      const kept = new Set([...presets].filter(([k]) => k !== key).flatMap(([, ids]) => [...ids]));
      const clear = [...added].filter((id) => !kept.has(id) && selected.has(id));
      setMany(clear, false);
      setPresets((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      setPresetNote(t('services.presetOn', { type, services: plural(lang, 'unit.servicesUnticked', clear.length) }));
      return;
    }
    const ids = preset.services.filter((id) => all.includes(id));
    setMany(ids, true);
    setPresets((prev) => new Map(prev).set(key, new Set(ids.filter((id) => !selected.has(id)))));
    setPresetNote(t('services.presetOn', { type, services: plural(lang, 'unit.servicesTicked', ids.length) }));
  }

  function setOpenCategory(key: string, on: boolean) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function save(requestId: string) {
    const ids = await saveShopServices([...selected], requestId);
    const next = new Set(ids);
    setSelected(next);
    setSaved(next);
  }

  return (
    <>
      <section className={own.presets} aria-labelledby="services-presets">
        <h2 id="services-presets" className={styles.section}>
          {t('services.presetsTitle')}
        </h2>
        <p className={own.hint}>{t('services.presetsHint')}</p>
        <div className={own.presetChips} role="group" aria-labelledby="services-presets">
          {SERVICE_PRESETS.map((p) => (
            <Chip key={p.key} selected={presets.has(p.key)} onClick={() => togglePreset(p.key)}>
              {t(`services.preset.${p.key}`)}
            </Chip>
          ))}
        </div>
        <p className={own.hint} role="status">
          {presetNote}
        </p>
      </section>

      <h2 className={styles.section}>{t('services.listTitle')}</h2>
      <div className={own.toolbar}>
        <p className={own.count} aria-live="polite">
          {t('services.count', { n: selected.size, total: all.length })}
        </p>
        <div className={own.bulk}>
          <Button variant="ghost" onClick={() => setMany(visibleIds, true)} disabled={visibleIds.length === 0}>
            {t('services.selectAll')}
          </Button>
          <Button variant="ghost" onClick={() => setMany(visibleIds, false)} disabled={visibleIds.length === 0}>
            {t('services.clearAll')}
          </Button>
        </div>
      </div>
      <Field
        label={t('services.search')}
        type="search"
        placeholder={t('services.searchPlaceholder')}
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {visible.length === 0 && (
        <EmptyState
          icon={SearchX}
          title={t('services.empty', { q: query.trim() })}
          action={<Button onClick={() => setQuery('')}>{t('services.clearSearch')}</Button>}
        />
      )}

      <div className={own.categories}>
        {visible.map((c) => {
          const full = catalog.find((x) => x.key === c.key)!;
          const ids = full.services.map((s) => s.id);
          const ticked = ids.filter((id) => selected.has(id)).length;
          // While searching, the matching services are shown open (and "Toate" would reach hidden ones).
          const expanded = searching || open.has(c.key);
          return (
            <section key={c.key} className={own.category}>
              <div className={own.categoryHead}>
                <h3 className={own.categoryTitle}>
                  <button
                    type="button"
                    className={own.categoryToggle}
                    aria-expanded={expanded}
                    aria-controls={`cat-${c.key}`}
                    disabled={searching}
                    onClick={() => setOpenCategory(c.key, !expanded)}
                  >
                    <ChevronDown size={18} aria-hidden="true" className={own.chevron} />
                    <span className={own.categoryName}>{name(c)}</span>
                    <span className={own.categoryCount}>{t('services.catCount', { n: ticked, total: ids.length })}</span>
                  </button>
                </h3>
                {!searching && (
                  <Checkbox
                    className={own.categoryAll}
                    checked={ticked === ids.length}
                    indeterminate={ticked > 0 && ticked < ids.length}
                    aria-label={t('services.catAllLabel', { category: name(c) })}
                    onChange={(e) => setMany(ids, e.target.checked)}
                  >
                    {t('services.catAll')}
                  </Checkbox>
                )}
              </div>
              {expanded && (
                <div id={`cat-${c.key}`} className={own.grid}>
                  {c.services.map((s) => (
                    <Checkbox
                      key={s.id}
                      className={own.service}
                      checked={selected.has(s.id)}
                      onChange={(e) => toggle(s.id, e.target.checked)}
                    >
                      {name(s)}
                    </Checkbox>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className={styles.stickySave}>
        {selected.size === 0 ? (
          <p className={styles.warn}>{t('services.none')}</p>
        ) : (
          changed && <p className={styles.warn}>{t('common.unsaved')}</p>
        )}
        <SaveButton onSave={save}>{t('services.save')}</SaveButton>
      </div>
    </>
  );
}
