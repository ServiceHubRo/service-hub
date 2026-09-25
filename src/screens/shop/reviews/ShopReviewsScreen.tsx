import { Star } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { BackLink } from '../../../components/BackLink';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { Stars } from '../../../components/Stars';
import { subscribeRows } from '../../../data/realtime';
import { fetchShopReviews, reviewSummary, type ShopReview } from '../../../data/reviews';
import { useI18n } from '../../../i18n/context';
import { formatRating } from '../../../i18n/format';
import { plural } from '../../../i18n/translate';
import { useLoad } from '../../../lib/useLoad';
import { ACCOUNT_PATH } from '../paths';
import { ReviewCard } from './ReviewCard';
import styles from './reviews.module.css';
import { useIsColleague } from '../shopRole';

/**
 * Recenzii, a tile in the shop's Cont (FR §4.5, P10): the average and the count, then every review
 * with its reply and report state. The shop replies (public, editable) and reports (four reasons,
 * decided by admin); it never changes the review itself. A new review appears live.
 */
export function ShopReviewsScreen() {
  const { t, lang } = useI18n();
  const load = useCallback(() => fetchShopReviews(), []);
  const { state, reload, setData } = useLoad(load);

  // A quiet read started before a newer change must not put the older list back.
  const generation = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const refresh = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const started = generation.current;
      fetchShopReviews().then(
        (data) => {
          if (started === generation.current) setData(data);
        },
        () => {},
      );
    }, 150);
  }, [setData]);

  const replace = useCallback(
    (review: Partial<ShopReview> & { id: string }) => {
      generation.current += 1;
      // The row an RPC or Realtime returns has no booking embedded: keep the one on screen.
      setData((prev) => ({ ...prev, reviews: prev.reviews.map((r) => (r.id === review.id ? { ...r, ...review, booking: r.booking } : r)) }));
    },
    [setData],
  );

  const shopId = state.status === 'ready' ? state.data.shopId : null;
  useEffect(() => {
    if (!shopId) return;
    return subscribeRows<Record<string, unknown>>({
      channel: `shop-reviews:${shopId}`,
      table: 'reviews',
      filter: `shop_id=eq.${shopId}`,
      onChange: (payload) => {
        const row = payload.new as Partial<ShopReview>;
        if (payload.eventType === 'UPDATE' && row.id) replace(row as Partial<ShopReview> & { id: string });
        else refresh(); // a new review: its booking comes with a read
      },
      onResync: refresh,
    });
  }, [shopId, replace, refresh]);

  const isColleague = useIsColleague();
  const reviews = state.status === 'ready' ? state.data.reviews : null;
  const summary = reviews ? reviewSummary(reviews) : null;

  return (
    <div className={styles.page}>
      <BackLink to={ACCOUNT_PATH} label={t('nav.account')} />
      <h1>{t('reviews.title')}</h1>
      {isColleague && <p className={styles.muted}>{t('reviews.staffNote')}</p>}
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('reviews.loadError')} onRetry={reload} />}
      {reviews &&
        summary &&
        (reviews.length === 0 ? (
          <EmptyState icon={Star} title={t('reviews.empty')} body={t('reviews.emptyBody')} />
        ) : (
          <>
            <Card className={styles.summary}>
              <span className={styles.average}>{summary.average === null ? '–' : formatRating(lang, summary.average)}</span>
              <div className={styles.summaryText}>
                {summary.average !== null && <Stars value={summary.average} size={18} />}
                <span className={styles.muted}>{plural(lang, 'unit.reviews', summary.count)}</span>
              </div>
            </Card>
            <ul className={styles.list}>
              {reviews.map((r) => (
                <li key={r.id}>
                  <ReviewCard review={r} onChanged={replace} onStale={refresh} />
                </li>
              ))}
            </ul>
          </>
        ))}
    </div>
  );
}
