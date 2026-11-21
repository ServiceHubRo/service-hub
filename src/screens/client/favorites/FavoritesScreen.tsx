import { Heart } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { DetailFrame, ListDetailLayout } from '../../../components/ListDetailLayout';
import { PageHeader } from '../../../components/PageHeader';
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
import { EmbeddedProvider } from '../../../lib/embedded';
import { RICH_PANEL_QUERY, useMediaQuery } from '../../../lib/useMediaQuery';
import { useLoad } from '../../../lib/useLoad';
import { NAV } from '../../../app/roles';
import { FAVORITES_PATH, SEARCH_PATH } from '../paths';
import { ShopPage } from '../shop/ShopPage';
import { ShopCard } from '../search/ShopCard';
import styles from '../search/SearchScreen.module.css';

/** The shop shown beside the list, kept while the reader goes to its reviews or services and back. */
const lastPicked = new Map<'shop', string>();

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

  const wide = useMediaQuery(RICH_PANEL_QUERY);
  const [pickedId, setPickedId] = useState<string | null>(lastPicked.get('shop') ?? null);
  const shops = state.status === 'ready' ? state.data.shops : [];
  const chosen = shops.find((s) => s.shop_id === pickedId) ?? shops[0];
  const back = { backTo: FAVORITES_PATH, backLabel: 'favorites' } as const;
  const beside = wide && state.status === 'ready' && shops.length > 0;

  const header = <PageHeader back={{ to: NAV.client.account.path, label: t('nav.account') }} title={t('favorites.title')} />;
  const list = (
    <>
      {state.status === 'loading' && <SkeletonList cards />}
      {state.status === 'error' && <LoadError message={t('favorites.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (shops.length === 0 ? (
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
            <p className={styles.count}>{plural(lang, 'unit.shops', shops.filter((s) => s.is_favorite).length)}</p>
            <ul className={styles.list} data-layout="cards">
              {shops.map((s) => (
                <li key={s.shop_id}>
                  <ShopCard
                    shop={s}
                    distanceKm={distanceTo(coords, s)}
                    back={back}
                    onFavorite={onFavorite}
                    // Beside the shop's panel (a laptop, C9) a card is chosen, not opened.
                    {...(beside
                      ? {
                          selected: s.shop_id === chosen?.shop_id,
                          onSelect: () => {
                            lastPicked.set('shop', s.shop_id);
                            setPickedId(s.shop_id);
                          },
                        }
                      : {})}
                  />
                </li>
              ))}
            </ul>
          </>
        ))}
      {state.status === 'ready' && state.data.hidden > 0 && (
        <p className={styles.count}>{t('favorites.hidden', { count: plural(lang, 'unit.shops', state.data.hidden) })}</p>
      )}
    </>
  );

  // Beside the saved shops (a laptop): the chosen shop's page on the right, as in Caută.
  if (wide) {
    return (
      <div className={styles.page}>
        <ListDetailLayout
          wide
          open={false}
          backTo={FAVORITES_PATH}
          backLabel={t('favorites.title')}
          header={header}
          list={list}
          detail={
            beside && chosen ? (
              <DetailFrame>
                <EmbeddedProvider value>
                  <ShopPage key={chosen.shop_id} shopId={chosen.shop_id} linkState={back} />
                </EmbeddedProvider>
              </DetailFrame>
            ) : null
          }
        />
      </div>
    );
  }
  return (
    <div className={styles.page}>
      {header}
      {list}
    </div>
  );
}
