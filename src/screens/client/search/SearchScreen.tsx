import { Heart, List, Map as MapIcon, SearchX } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveSearchParams } from '../../../app/useLiveSearchParams';
import { Button } from '../../../components/Button';
import { CheckMenu } from '../../../components/CheckMenu';
import { EmptyState } from '../../../components/EmptyState';
import { Field } from '../../../components/Field';
import { ActiveFilters, FilterGroup, FilterSheet, FiltersButton } from '../../../components/Filters';
import { LoadError } from '../../../components/LoadError';
import { SearchField } from '../../../components/SearchField';
import { SelectField } from '../../../components/SelectField';
import { SkeletonList } from '../../../components/Skeleton';
import { Switch } from '../../../components/Switch';
import { searchShops, type ShopSearchResult } from '../../../data/rpc';
import { fetchCategories, fetchCities, type SearchCategory, type SearchCity } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { formatDate, ymdInBucharest } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import { plural } from '../../../i18n/translate';
import { AMENITIES, isAmenity } from '../../../lib/amenities';
import { resolveDay } from '../../../lib/freePlace';
import { hasOffer } from '../../../lib/offers';
import { distanceTo, nearby, sortByDistance } from '../../../lib/geo';
import { useLocation } from '../../../lib/location';
import { cityNamedBy, fold } from '../../../lib/text';
import { useLoad } from '../../../lib/useLoad';
import { PushBanner } from '../../push/PushBanner';
import { SEARCH_PATH, shopPath, type ShopLinkState } from '../paths';
import { useFreePlaceText } from '../../../lib/useFreePlaceText';
import { formatRating } from '../../../i18n/format';
import { AreaCard } from './AreaCard';
import { ExpiryBanner } from './ExpiryBanner';
import { LocationBanner } from './LocationBanner';
import { ReviewPrompt } from './ReviewPrompt';
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

/** The map, loaded only when the client opens it (T28b). */
const ShopsMap = lazy(() => import('../../../components/map/ShopsMap'));

/** Last results per search, so coming back from a shop page shows the list at once (then refreshes). */
const cache = new Map<string, ShopSearchResult[]>();

/**
 * Caută (FR §3.1; P11, P16, P16d): one field for name, city or service; everything else (day,
 * instant confirmation, favorites, category, city, facilities, order) sits in the "Filtre" panel,
 * and what is on shows above the list with its own ✕; "Aproape de tine" when the client shares their location. The order is the weighted
 * rating from the database — filters only narrow it, distance is a separate section and sort.
 * The filters live in the address (?q=&cat=&oras=&fav=1&sort=aproape&zi=&instant=1&oferta=1&fac=), so Back restores
 * them. A day (T28a: azi, maine or a date) keeps only shops with a free place that day; "Confirmare
 * instantă" only shops that confirm at once — both narrow, neither reorders.
 */
export function SearchScreen() {
  const { t, lang } = useI18n();
  const [params, setParams] = useLiveSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('cat') ?? '';
  const city = params.get('oras') ?? '';
  const favOnly = params.get('fav') === '1';
  const byDistance = params.get('sort') === 'aproape';
  const asMap = params.get('vedere') === 'harta';
  const navigate = useNavigate();
  const freeText = useFreePlaceText();
  const dayParam = params.get('zi');
  const day = resolveDay(dayParam);
  const instantOnly = params.get('instant') === '1';
  /** Only shops with an offer (Eduard, 8 Oct): narrows, never reorders. */
  const offerOnly = params.get('oferta') === '1';
  /** Facilities asked for (T28b): a shop shows only with every one of them. */
  const facParam = params.get('fac') ?? '';
  const wanted = useMemo(() => facParam.split(',').filter(isAmenity), [facParam]);
  /** "Altă zi" open: the date field shows (also while a date is picked). */
  const [pickDay, setPickDay] = useState(false);
  const datePicked = Boolean(day && dayParam !== 'azi' && dayParam !== 'maine');
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
  const key = JSON.stringify([q.trim(), category, city, day ?? '']);
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
    const [query, cat, town, onDay] = JSON.parse(key) as [string, string, string, string];
    searchShops({ q: query || undefined, category: cat || undefined, city: town || undefined, day: onDay || undefined }).then(
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
    const narrowed = all.filter(
      (s) =>
        (!favOnly || s.is_favorite) &&
        (!instantOnly || s.auto_confirm) &&
        (!offerOnly || hasOffer(s.offers)) &&
        wanted.every((a) => s.amenities.includes(a)),
    );
    return byDistance && coords ? sortByDistance(narrowed, distance) : narrowed;
  }, [results, favOnly, instantOnly, offerOnly, wanted, byDistance, coords, distance]);
  const near = useMemo(() => (coords && !byDistance ? nearby(list, distance) : []), [coords, byDistance, list, distance]);

  const filtersOn = Boolean(category || city || favOnly || day || instantOnly || offerOnly || wanted.length > 0);
  const [explainOpen, setExplainOpen] = useState(false);
  const explainId = useId();
  // What is typed right now, even if the address has not caught up yet (a result tapped quickly).
  const backParams = new URLSearchParams(params);
  if (text.trim()) backParams.set('q', text);
  else backParams.delete('q');
  const back: ShopLinkState = { backTo: `${SEARCH_PATH}?${backParams.toString()}`, backLabel: 'search' };

  function clearFilters() {
    autoCity.current = null;
    setPickDay(false);
    setParam({ cat: null, oras: null, fav: null, zi: null, instant: null, oferta: null, fac: null });
  }

  function clearQuery() {
    const picked = autoCity.current;
    autoCity.current = null;
    setText('');
    setParam({ q: null, ...(picked && picked === city ? { oras: null } : {}) });
  }

  const cityName = cities?.find((c) => fold(c.city) === fold(city))?.city ?? city;

  // ------------------------------------------------------------------ the filters panel
  const [filtersOpen, setFiltersOpen] = useState(false);

  /** What narrows or reorders the list now, in one line above the results. */
  const categoryName = (() => {
    const c = meta.status === 'ready' ? meta.data.categories.find((x) => x.key === category) : undefined;
    return c ? (lang === 'ro' ? c.name_ro : c.name_en) : null;
  })();
  const active: { key: string; label: string }[] = [];
  if (day) {
    active.push({
      key: 'zi',
      label:
        dayParam === 'azi' ? t('search.when.today') : dayParam === 'maine' ? t('search.when.tomorrow') : formatDate(lang, day),
    });
  }
  if (instantOnly) active.push({ key: 'instant', label: t('instant.badge') });
  if (offerOnly) active.push({ key: 'oferta', label: t('search.withOffer') });
  if (favOnly) active.push({ key: 'fav', label: t('search.favorites') });
  if (category && categoryName) active.push({ key: 'cat', label: categoryName });
  if (city) active.push({ key: 'oras', label: cityName });
  for (const a of wanted) active.push({ key: `fac:${a}`, label: t(`amenity.${a}` as MessageKey) });
  if (byDistance && coords) active.push({ key: 'sort', label: t('search.sort.nearest') });

  const countText = city
    ? t('search.countIn', { count: plural(lang, 'unit.shops', list.length), city: cityName })
    : plural(lang, 'unit.shops', list.length);

  return (
    <div className={styles.page}>
      <h1>{t('nav.client.search')}</h1>

      <ExpiryBanner />
      <ReviewPrompt />
      <PushBanner role="client" />
      <LocationBanner />
      <AreaCard />

      <SearchField
        id="search-q"
        label={t('search.label')}
        placeholder={t('search.placeholder')}
        value={text}
        onChange={setText}
        onClear={clearQuery}
        clearLabel={t('search.clearQuery')}
      />

      <div className={styles.toolbar}>
        <FiltersButton count={active.length} onClick={() => setFiltersOpen(true)} />
        {/* One button that switches to the other view (no pair of pills). */}
        <button type="button" className={styles.viewButton} onClick={() => setParam({ vedere: asMap ? null : 'harta' })}>
          {asMap ? <List size={16} aria-hidden="true" /> : <MapIcon size={16} aria-hidden="true" />}
          {t(asMap ? 'search.view.list' : 'search.view.map')}
        </button>
      </div>

      <ActiveFilters items={active} onClearAll={filtersOn ? clearFilters : undefined} />

      {meta.status === 'error' && <LoadError message={t('search.loadError')} onRetry={reloadMeta} />}

      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        onClear={clearFilters}
        clearDisabled={!filtersOn}
        doneLabel={
          status === 'ready' || results ? t('filters.show', { count: plural(lang, 'unit.shops', list.length) }) : undefined
        }
      >
        {meta.status === 'loading' && <SkeletonList count={2} />}
        {meta.status === 'ready' && (
          <>
            <SelectField
              label={t('search.when')}
              value={datePicked || pickDay ? 'zi' : (dayParam ?? '')}
              options={[
                { value: '', label: t('search.when.any') },
                { value: 'azi', label: t('search.when.today') },
                { value: 'maine', label: t('search.when.tomorrow') },
                { value: 'zi', label: t('search.when.pick') },
              ]}
              onChange={(e) => {
                const v = e.target.value;
                setPickDay(v === 'zi');
                if (v !== 'zi') setParam({ zi: v || null });
              }}
            />
            {(pickDay || datePicked) && (
              <Field
                className={styles.dayField}
                type="date"
                label={t('search.when.date')}
                min={ymdInBucharest(new Date())}
                value={datePicked && day ? day : ''}
                onChange={(e) => setParam({ zi: e.target.value || null })}
              />
            )}
            <SelectField
              label={t('search.categories')}
              value={category ?? ''}
              options={[
                { value: '', label: t('search.allCategories') },
                ...meta.data.categories.map((c) => ({ value: c.key, label: lang === 'ro' ? c.name_ro : c.name_en })),
              ]}
              onChange={(e) => setParam({ cat: e.target.value || null })}
            />
            {meta.data.cities.length > 0 && (
              <SelectField
                label={t('search.cities')}
                value={meta.data.cities.find((c) => fold(c.city) === fold(city))?.city ?? ''}
                options={[{ value: '', label: t('search.allCities') }, ...meta.data.cities.map((c) => ({ value: c.city, label: c.city }))]}
                onChange={(e) => {
                  autoCity.current = null;
                  setParam({ oras: e.target.value || null });
                }}
              />
            )}
            <CheckMenu
              label={t('search.amenities')}
              summary={wanted.length ? wanted.map((a) => t(`amenity.${a}` as MessageKey)).join(', ') : t('search.amenities.any')}
              options={AMENITIES.map((a) => ({ value: a, label: t(`amenity.${a}` as MessageKey) }))}
              selected={wanted}
              onToggle={(a) => {
                const on = wanted.includes(a as (typeof AMENITIES)[number]);
                const next = on ? wanted.filter((x) => x !== a) : AMENITIES.filter((x) => x === a || wanted.includes(x));
                setParam({ fac: next.length ? next.join(',') : null });
              }}
            />
            {coords && (
              <SelectField
                label={t('search.sortBy')}
                value={byDistance ? 'aproape' : ''}
                options={[
                  { value: '', label: t('search.sort.recommended') },
                  { value: 'aproape', label: t('search.sort.nearest') },
                ]}
                onChange={(e) => setParam({ sort: e.target.value || null })}
              />
            )}
            <FilterGroup title={t('search.more')}>
              <Switch checked={instantOnly} onChange={(e) => setParam({ instant: e.target.checked ? '1' : null })}>
                {t('instant.badge')}
              </Switch>
              <Switch checked={offerOnly} onChange={(e) => setParam({ oferta: e.target.checked ? '1' : null })}>
                {t('search.withOffer')}
              </Switch>
              <Switch checked={favOnly} onChange={(e) => setParam({ fav: e.target.checked ? '1' : null })}>
                {t('search.favorites')}
              </Switch>
            </FilterGroup>
          </>
        )}
      </FilterSheet>

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

          {asMap && list.length > 0 ? (
            <section className={styles.section} aria-label={t('search.view.map')}>
              <Suspense fallback={<div className={styles.mapLoading} aria-busy="true" />}>
                <ShopsMap
                  label={t('search.map.label')}
                  openLabel={t('search.map.open')}
                  onOpen={(id) => navigate(day ? `${shopPath(id)}?zi=${day}` : shopPath(id), { state: back })}
                  shops={list
                    .filter((s) => s.latitude !== null && s.longitude !== null)
                    .map((s) => ({
                      id: s.shop_id,
                      name: s.name,
                      latitude: s.latitude!,
                      longitude: s.longitude!,
                      detail: [
                        s.review_count > 0 && s.average !== null ? `★ ${formatRating(lang, Number(s.average))}` : '',
                        s.free ? freeText(s.free) : '',
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    }))}
                />
              </Suspense>
              {list.some((s) => s.latitude === null || s.longitude === null) && (
                <p className={styles.mapNote}>
                  {t('search.map.missing', { n: list.filter((s) => s.latitude === null || s.longitude === null).length })}
                </p>
              )}
            </section>
          ) : list.length === 0 ? (
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
                    {t('filters.clear')}
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
                        <ShopCard shop={s} distanceKm={distance(s)} back={back} onFavorite={onFavorite} day={day} />
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
                      <ShopCard shop={s} distanceKm={distance(s)} back={back} onFavorite={onFavorite} day={day} />
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
