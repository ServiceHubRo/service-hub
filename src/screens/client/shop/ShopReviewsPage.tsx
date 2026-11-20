import { Star, Store } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { DetailPane, ListDetailLayout } from '../../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../../components/ListRow';
import { LoadError } from '../../../components/LoadError';
import { PageHeader } from '../../../components/PageHeader';
import { ShopAvatar } from '../../../components/ShopAvatar';
import { Stars } from '../../../components/Stars';
import { subscribeRows } from '../../../data/realtime';
import { toRpcError } from '../../../data/rpc';
import { fetchShopPage } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { formatDayMonth, formatRating } from '../../../i18n/format';
import { plural } from '../../../i18n/translate';
import { useListDetail } from '../../../lib/useListDetail';
import { useLoad } from '../../../lib/useLoad';
import { SEARCH_PATH, shopPath, shopReviewsPath, type ShopLinkState } from '../paths';
import styles from './shopReviews.module.css';

/**
 * The reviews of one shop, on a screen of their own (C9, Eduard, 21 Nov 2026): the shop page shows
 * only the stars; they open this. Page template A: the reviews as rows on the left, the chosen one
 * on the right with everything — the stars, what the client wrote, the shop's reply. The latest 50
 * come with the shop page's one read (get_shop_page); a new review or reply arrives live.
 */
export function ShopReviewsPage() {
  const { t, lang } = useI18n();
  const { shopId = '' } = useParams();
  const load = useCallback(() => fetchShopPage(shopId), [shopId]);
  const { state, reload, setData } = useLoad(load);

  const ready = state.status === 'ready';
  useEffect(() => {
    if (!ready || !shopId) return;
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        fetchShopPage(shopId).then(setData, () => {});
      }, 200);
    };
    const unsubscribe = subscribeRows({
      channel: `shop-reviews-page:${shopId}`,
      table: 'reviews',
      filter: `shop_id=eq.${shopId}`,
      onChange: refresh,
      onResync: () => {},
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [ready, shopId, setData]);

  const page = ready ? state.data : null;
  const reviews = page?.reviews ?? null;
  const { wide, selectedId, open, select } = useListDetail((reviews ?? []).map((r) => r.id), 'recenzie');
  const chosen = reviews?.find((r) => r.id === selectedId) ?? null;
  // From a search card (its stars) the way back is the search; from the shop page, the shop page.
  const from = useLocation().state as ShopLinkState | null;
  const back = from?.backTo
    ? { to: from.backTo, label: from.backLabel === 'favorites' ? t('favorites.title') : t('shop.allShops') }
    : { to: shopPath(shopId), label: page?.shop.name ?? t('shop.allShops') };

  const header = (
    <>
      <PageHeader back={back} title={t('shop.reviews')} subtitle={page?.shop.name} />
      {page && page.rating.review_count > 0 && page.rating.average !== null && (
        <Card className={styles.summary}>
          <span className={styles.average}>{formatRating(lang, page.rating.average)}</span>
          <div className={styles.summaryText}>
            <Stars value={page.rating.average} size={18} />
            <span className={styles.muted}>{plural(lang, 'unit.reviews', page.rating.review_count)}</span>
          </div>
        </Card>
      )}
    </>
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error')
    list =
      toRpcError(state.error).code === 'shop_not_found' ? (
        <EmptyState
          icon={Store}
          title={t('shop.notFound')}
          body={t('shop.notFoundBody')}
          action={
            <Link to={SEARCH_PATH} className={buttonClass('primary')}>
              {t('shop.allShops')}
            </Link>
          }
        />
      ) : (
        <LoadError message={t('shop.loadError')} onRetry={reload} />
      );
  else if (reviews && reviews.length === 0) list = <EmptyState icon={Star} title={t('rating.none')} />;
  else if (reviews)
    list = (
      <ListRows label={t('shop.reviews')}>
        {reviews.map((r) => (
          <ListRow
            key={r.id}
            icon={<ShopAvatar name={r.display_name} logoUrl={null} size={36} />}
            title={r.display_name}
            detail={[formatDayMonth(lang, new Date(r.created_at)), r.text].filter(Boolean).join(' · ')}
            status={<Stars value={r.rating} size={14} />}
            selected={wide && r.id === selectedId}
            onSelect={() => select(r.id)}
          />
        ))}
      </ListRows>
    );

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={shopReviewsPath(shopId)}
        backLabel={t('shop.reviews')}
        header={header}
        list={list}
        detail={
          chosen && (
            <DetailPane
              key={chosen.id}
              id={chosen.id}
              icon={<ShopAvatar name={chosen.display_name} logoUrl={null} size={36} />}
              title={chosen.display_name}
              detail={formatDayMonth(lang, new Date(chosen.created_at))}
              status={<Stars value={chosen.rating} size={18} />}
            >
              {chosen.text && <p className={styles.text}>{chosen.text}</p>}
              {chosen.reply && (
                <Card inset className={styles.reply}>
                  <p className={styles.replyLabel}>{t('shop.reply')}</p>
                  <p className={styles.text}>{chosen.reply}</p>
                  {chosen.reply_at && <p className={styles.muted}>{formatDayMonth(lang, new Date(chosen.reply_at))}</p>}
                </Card>
              )}
            </DetailPane>
          )
        }
      />
    </div>
  );
}
