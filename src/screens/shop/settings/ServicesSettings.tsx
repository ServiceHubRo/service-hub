import { ChevronDown, SearchX } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { BackLink } from '../../../components/BackLink';
import { Button } from '../../../components/Button';
import { Checkbox } from '../../../components/Checkbox';
import { EmptyState } from '../../../components/EmptyState';
import { Field } from '../../../components/Field';
import { SelectField } from '../../../components/SelectField';
import { SkeletonList } from '../../../components/Skeleton';
import { fetchCatalog, fetchShopServices, saveShopServices, type CatalogCategory } from '../../../data/shop';
import { useI18n } from '../../../i18n/context';
import { plural } from '../../../i18n/translate';
import { SERVICE_PRESETS } from '../../../lib/servicePresets';
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
 * Servicii oferite (P5): the catalog with checkboxes, search without diacritics, no prices. Kept
 * quiet (Eduard, 19 Oct): one picker ticks the usual services of a kind of workshop; the categories
 * are closed rows with how many are ticked, and open on a tap with "Toate" as their first line.
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

  const changed = selected.size !== saved.size || [...selected].some((id) => !saved.has(id));

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

  /** A kind of workshop: its usual services are ticked (nothing is unticked); the picker empties again. */
  function applyPreset(key: string) {
    const preset = SERVICE_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    const ids = preset.services.filter((id) => all.includes(id));
    setMany(ids, true);
    setPresetNote(t('services.presetOn', { type: t(`services.preset.${preset.key}`), services: plural(lang, 'unit.servicesTicked', ids.length) }));
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
      <div className={own.top}>
        <SelectField
          label={t('services.presetLabel')}
          value=""
          options={[
            { value: '', label: t('services.presetPick') },
            ...SERVICE_PRESETS.map((p) => ({ value: p.key, label: t(`services.preset.${p.key}`) })),
          ]}
          onChange={(e) => applyPreset(e.target.value)}
        />
        <p className={own.note} role="status">
          {presetNote}
        </p>
        <Field
          label={t('services.search')}
          type="search"
          placeholder={t('services.searchPlaceholder')}
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className={own.count} aria-live="polite">
          {t('services.count', { n: selected.size, total: all.length })}
        </p>
      </div>

      {visible.length === 0 && (
        <EmptyState
          icon={SearchX}
          title={t('services.empty', { q: query.trim() })}
          action={<Button onClick={() => setQuery('')}>{t('services.clearSearch')}</Button>}
        />
      )}

      <div className={own.categories}>
        {visible.map((c) => {
          const ids = catalog.find((x) => x.key === c.key)!.services.map((s) => s.id);
          const ticked = ids.filter((id) => selected.has(id)).length;
          // While searching, the matching services are shown open (and "Toate" would reach hidden ones).
          const expanded = searching || open.has(c.key);
          return (
            <section key={c.key} className={`${own.category} ${expanded ? own.categoryOpen : ''}`}>
              <h3 className={own.categoryTitle}>
                <button
                  type="button"
                  className={own.categoryToggle}
                  aria-expanded={expanded}
                  aria-controls={`cat-${c.key}`}
                  disabled={searching}
                  onClick={() => setOpenCategory(c.key, !expanded)}
                >
                  <span className={own.categoryName}>{name(c)}</span>
                  <span className={`${own.categoryCount} ${ticked > 0 ? own.categoryCountOn : ''}`}>
                    {t('services.catCount', { n: ticked, total: ids.length })}
                  </span>
                  {!searching && <ChevronDown size={18} aria-hidden="true" className={own.chevron} />}
                </button>
              </h3>
              {expanded && (
                <div id={`cat-${c.key}`} className={own.items}>
                  {!searching && (
                    <Checkbox
                      className={`${own.item} ${own.itemAll}`}
                      checked={ticked === ids.length}
                      indeterminate={ticked > 0 && ticked < ids.length}
                      aria-label={t('services.catAllLabel', { category: name(c) })}
                      onChange={(e) => setMany(ids, e.target.checked)}
                    >
                      {t('services.catAll')}
                    </Checkbox>
                  )}
                  {c.services.map((s) => (
                    <Checkbox
                      key={s.id}
                      className={own.item}
                      checked={selected.has(s.id)}
                      onChange={(e) => setMany([s.id], e.target.checked)}
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
