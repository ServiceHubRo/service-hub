import { Heart, SearchX, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { Chip, ChipRow } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SearchField } from '../../../components/SearchField';
import { SkeletonList } from '../../../components/Skeleton';
import { searchShops, type ShopSearchResult } from '../../../data/rpc';
import { fetchCategories, fetchCities, type SearchCategory, type SearchCity } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { plural } from '../../../i18n/translate';
import { distanceTo, nearby, sortByDistance } from '../../../lib/geo';
import { useLocation } from '../../../lib/location';
import { cityNamedBy, fold } from '../../../lib/text';
import { useLoad } from '../../../lib/useLoad';
import { PushBanner } from '../../push/PushBanner';
import { SEARCH_PATH, type ShopLinkState } from '../paths';
import { ExpiryBanner } from './ExpiryBanner';
import { LocationBanner } from './LocationBanner';
import { RankingExplanation, RankingToggle } from './RankingInfo';
import { ShopCard } from './ShopCard';
import styles from './SearchScreen.module.css';

interface Meta {
  categories: SearchCategory[];
  cities: SearchCity[];
}

const loadMeta = async (): Promise<Meta> => {
  const [categories, cities] = await Promise.all([fetchCategories(), fetchCities()]);
  return { categories, cities };
};

/** Last results per search, so coming back from a shop page shows the list at once (then refreshes). */
const cache = new Map<string, ShopSearchResult[]>();

/**
 * Caută (FR §3.1; P11, P16, P16d): one field for name, city or service; category and city chips;
 * favorites; "Aproape de tine" when the client shares their location. The order is the weighted
 * rating from the database — filters only narrow it, distance is a separate section and sort.
 * The filters live in the address (?q=&cat=&oras=&fav=1&sort=aproape), so Back restores them.
 */
export function SearchScreen() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('cat') ?? '';
  const city = params.get('oras') ?? '';
  const favOnly = params.get('fav') === '1';
  const byDistance = params.get('sort') === 'aproape';
  const location = useLocation();
  const coords = location.coords;

  const { state: meta, reload: reloadMeta } = useLoad(loadMeta);
  const cities = meta.status === 'ready' ? meta.data.cities : null;

  // Changes start from the address as it is right now (history is updated at once, React renders a
  // bit later), so a chip tapped while the typing timer fires never loses either change.
  const setParamsRef = useRef(setParams);
  useEffect(() => {
    setParamsRef.current = setParams;
  }, [setParams]);
  const setParam = useCallback((changes: Record<string, string | null>) => {
    const current = window.location.search.replace(/^\?/, '');
    const next = new URLSearchParams(current);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (next.toString() !== current) setParamsRef.current(next, { replace: true });
  }, []);

  // ------------------------------------------------------------------ the search field
  const [text, setText] = useState(q);
  /** The city chip this screen picked because the query named it (undone when the query changes). */
  const autoCity = useRef<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      const changes: Record<string, string | null> = { q: text.trim() ? text : null };
      if (cities) {
        const named = cityNamedBy(text, cities);
        if (named) {
          changes.oras = named;
          autoCity.current = named;
        } else if (autoCity.current) {
          if (autoCity.current === city) changes.oras = null;
          autoCity.current = null;
        }
      }
      setParam(changes);
    }, 250);
    return () => window.clearTimeout(id);
    // `city` is read only to undo our own pick; a chip tap must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, cities, setParam]);

  // ------------------------------------------------------------------ results
  const key = JSON.stringify([q.trim(), category, city]);
  const [results, setResults] = useState<{ key: string; data: ShopSearchResult[] } | null>(() => {
    const cached = cache.get(key);
    return cached ? { key, data: cached } : null;
  });
  const [attempt, setAttempt] = useState(0);
  const fetchKey = `${key}#${attempt}`;
  /** The answer to the latest request: while it is for an older one, the list shows as loading. */
  const [answer, setAnswer] = useState<{ fetchKey: string; ok: boolean } | null>(null);
  const status = answer?.fetchKey !== fetchKey ? 'loading' : answer.ok ? 'ready' : 'error';

  useEffect(() => {
    let cancelled = false;
    const [query, cat, town] = JSON.parse(key) as [string, string, string];
    searchShops({ q: query || undefined, category: cat || undefined, city: town || undefined }).then(
      (data) => {
        if (cancelled) return;
        cache.set(key, data);
        setResults({ key, data });
        setAnswer({ fetchKey, ok: true });
      },
      () => {
        if (!cancelled) setAnswer({ fetchKey, ok: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, fetchKey]);

  function onFavorite(shopId: string, on: boolean) {
    cache.clear();
    setResults((prev) => {
      if (!prev) return prev;
      const data = prev.data.map((s) => (s.shop_id === shopId ? { ...s, is_favorite: on } : s));
      cache.set(prev.key, data);
      return { ...prev, data };
    });
  }

  const distance = useCallback((s: ShopSearchResult) => distanceTo(coords, s), [coords]);
  const list = useMemo(() => {
    const all = results?.data ?? [];
    const narrowed = favOnly ? all.filter((s) => s.is_favorite) : all;
    return byDistance && coords ? sortByDistance(narrowed, distance) : narrowed;
  }, [results, favOnly, byDistance, coords, distance]);
  const near = useMemo(() => (coords && !byDistance ? nearby(list, distance) : []), [coords, byDistance, list, distance]);

  const filtersOn = Boolean(category || city || favOnly);
  const [explainOpen, setExplainOpen] = useState(false);
  const explainId = useId();
  // What is typed right now, even if the address has not caught up yet (a result tapped quickly).
  const backParams = new URLSearchParams(params);
  if (text.trim()) backParams.set('q', text);
  else backParams.delete('q');
  const back: ShopLinkState = { backTo: `${SEARCH_PATH}?${backParams.toString()}`, backLabel: 'search' };

  function clearFilters() {
    autoCity.current = null;
    setParam({ cat: null, oras: null, fav: null });
  }

  function clearQuery() {
    const picked = autoCity.current;
    autoCity.current = null;
    setText('');
    setParam({ q: null, ...(picked && picked === city ? { oras: null } : {}) });
  }

  const cityName = cities?.find((c) => fold(c.city) === fold(city))?.city ?? city;
  const countText = city
    ? t('search.countIn', { count: plural(lang, 'unit.shops', list.length), city: cityName })
    : plural(lang, 'unit.shops', list.length);

  return (
    <div className={styles.page}>
      <h1>{t('nav.client.search')}</h1>

      <ExpiryBanner />
      <PushBanner role="client" />
      <LocationBanner />

      <SearchField
        id="search-q"
        label={t('search.label')}
        placeholder={t('search.placeholder')}
        value={text}
        onChange={setText}
        onClear={clearQuery}
        clearLabel={t('search.clearQuery')}
      />

      {meta.status === 'error' && <LoadError message={t('search.loadError')} onRetry={reloadMeta} />}
      {meta.status === 'ready' && (
        <div className={styles.filters}>
          <ChipRow label={t('search.categories')}>
            <Chip selected={!category} onClick={() => setParam({ cat: null })}>
              {t('search.allCategories')}
            </Chip>
            {meta.data.categories.map((c) => (
              <Chip key={c.key} selected={category === c.key} onClick={() => setParam({ cat: category === c.key ? null : c.key })}>
                {lang === 'ro' ? c.name_ro : c.name_en}
              </Chip>
            ))}
          </ChipRow>
          {meta.data.cities.length > 0 && (
            <ChipRow label={t('search.cities')}>
              <Chip
                selected={!city}
                onClick={() => {
                  autoCity.current = null;
                  setParam({ oras: null });
                }}
              >
                {t('search.allCities')}
              </Chip>
              {meta.data.cities.map((c) => {
                const on = fold(city) === fold(c.city);
                return (
                  <Chip
                    key={c.city}
                    selected={on}
                    onClick={() => {
                      autoCity.current = null;
                      setParam({ oras: on ? null : c.city });
                    }}
                  >
                    {c.city}
                  </Chip>
                );
              })}
            </ChipRow>
          )}
          <ChipRow label={t('search.more')}>
            <Chip selected={favOnly} onClick={() => setParam({ fav: favOnly ? null : '1' })}>
              <Heart size={14} aria-hidden="true" className={favOnly ? styles.heartOn : undefined} />
              {t('search.favorites')}
            </Chip>
            {filtersOn && (
              <Chip onClick={clearFilters}>
                <X size={14} aria-hidden="true" />
                {t('search.clearFilters')}
              </Chip>
            )}
            {coords && (
              <>
                <span className={styles.divider} aria-hidden="true" />
                <Chip selected={!byDistance} onClick={() => setParam({ sort: null })}>
                  {t('search.sort.recommended')}
                </Chip>
                <Chip selected={byDistance} onClick={() => setParam({ sort: 'aproape' })}>
                  {t('search.sort.nearest')}
                </Chip>
              </>
            )}
          </ChipRow>
        </div>
      )}

      {status === 'error' && <LoadError message={t('search.resultsError')} onRetry={() => setAttempt((a) => a + 1)} />}
      {status !== 'error' && !results && <SkeletonList />}
      {status !== 'error' && results && (
        <div className={styles.results} aria-busy={status === 'loading'}>
          <div className={styles.countRow}>
            <p className={styles.count} role="status">
              {countText}
            </p>
            <RankingToggle open={explainOpen} onToggle={() => setExplainOpen((o) => !o)} controls={explainId} />
          </div>
          {explainOpen && <RankingExplanation id={explainId} />}

          {list.length === 0 ? (
            <EmptyState
              icon={favOnly && !q && !category && !city ? Heart : SearchX}
              title={
                favOnly && !q && !category && !city
                  ? t('search.empty.favorites')
                  : q.trim()
                    ? t('search.empty.query', { q: q.trim() })
                    : t('search.empty.filters')
              }
              body={
                favOnly && !q && !category && !city
                  ? t('search.empty.favoritesBody')
                  : filtersOn
                    ? t('search.empty.filtersBody')
                    : t('search.empty.queryBody')
              }
              action={
                filtersOn ? (
                  <Button variant="primary" onClick={clearFilters}>
                    {t('search.clearFilters')}
                  </Button>
                ) : q ? (
                  <Button onClick={clearQuery}>{t('search.clearQuery')}</Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {near.length > 0 && (
                <section className={styles.section} aria-labelledby="near-title">
                  <h2 id="near-title" className={styles.sectionTitle}>
                    {t('search.near')}
                  </h2>
                  <ul className={styles.list}>
                    {near.map((s) => (
                      <li key={s.shop_id}>
                        <ShopCard shop={s} distanceKm={distance(s)} back={back} onFavorite={onFavorite} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section className={styles.section} aria-labelledby={near.length > 0 ? 'all-title' : undefined}>
                {near.length > 0 && (
                  <h2 id="all-title" className={styles.sectionTitle}>
                    {t('search.allResults')}
                  </h2>
                )}
                <ul className={styles.list}>
                  {list.map((s) => (
                    <li key={s.shop_id}>
                      <ShopCard shop={s} distanceKm={distance(s)} back={back} onFavorite={onFavorite} />
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
