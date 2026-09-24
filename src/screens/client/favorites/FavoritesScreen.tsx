import { Heart } from 'lucide-react';
import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { BackLink } from '../../../components/BackLink';
import { buttonClass } from '../../../components/buttonClass';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { searchShops, type ShopSearchResult } from '../../../data/rpc';
import { countFavorites } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { plural } from '../../../i18n/translate';
import { distanceTo } from '../../../lib/geo';
import { useLocation } from '../../../lib/location';
import { useLoad } from '../../../lib/useLoad';
import { NAV } from '../../../app/roles';
import { FAVORITES_PATH, SEARCH_PATH } from '../paths';
import { ShopCard } from '../search/ShopCard';
import styles from '../search/SearchScreen.module.css';

interface Loaded {
  shops: ShopSearchResult[];
  /** Saved shops that are hidden from search right now (not shown). */
  hidden: number;
}

async function loadFavorites(): Promise<Loaded> {
  const [all, total] = await Promise.all([searchShops(), countFavorites()]);
  const shops = all.filter((s) => s.is_favorite);
  return { shops, hidden: Math.max(0, total - shops.length) };
}

/**
 * Cont → Favorite (FR §3.8): the client's saved shops, in the same order as search. A heart
 * turned off keeps its card until the client leaves, so a mistaken tap can be undone.
 */
export function FavoritesScreen() {
  const { t, lang } = useI18n();
  const { coords } = useLocation();
  const load = useCallback(() => loadFavorites(), []);
  const { state, reload, setData } = useLoad(load);

  function onFavorite(shopId: string, on: boolean) {
    setData((prev) => ({ ...prev, shops: prev.shops.map((s) => (s.shop_id === shopId ? { ...s, is_favorite: on } : s)) }));
  }

  return (
    <div className={styles.page}>
      <BackLink to={NAV.client.account.path} label={t('nav.account')} />
      <h1>{t('favorites.title')}</h1>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('favorites.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (state.data.shops.length === 0 ? (
          <EmptyState
            icon={Heart}
            title={t('search.empty.favorites')}
            body={t('search.empty.favoritesBody')}
            action={
              <Link to={SEARCH_PATH} className={buttonClass('primary')}>
                {t('favorites.find')}
              </Link>
            }
          />
        ) : (
          <>
            <p className={styles.count}>{plural(lang, 'unit.shops', state.data.shops.filter((s) => s.is_favorite).length)}</p>
            <ul className={styles.list}>
              {state.data.shops.map((s) => (
                <li key={s.shop_id}>
                  <ShopCard
                    shop={s}
                    distanceKm={distanceTo(coords, s)}
                    back={{ backTo: FAVORITES_PATH, backLabel: 'favorites' }}
                    onFavorite={onFavorite}
                  />
                </li>
              ))}
            </ul>
          </>
        ))}
      {state.status === 'ready' && state.data.hidden > 0 && (
        <p className={styles.count}>{t('favorites.hidden', { count: plural(lang, 'unit.shops', state.data.hidden) })}</p>
      )}
    </div>
  );
}
