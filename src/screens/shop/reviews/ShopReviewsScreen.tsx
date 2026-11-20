import { Star } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { PageHeader } from '../../../components/PageHeader';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { ListDetailLayout } from '../../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../../components/ListRow';
import { ShopAvatar } from '../../../components/ShopAvatar';
import { StatusPill } from '../../../components/StatusPill';
import { Stars } from '../../../components/Stars';
import { subscribeRows } from '../../../data/realtime';
import { fetchShopReviews, reviewSummary, type ShopReview } from '../../../data/reviews';
import { useI18n } from '../../../i18n/context';
import { formatDayMonth, formatRating } from '../../../i18n/format';
import { plural } from '../../../i18n/translate';
import { toneOf } from '../../../lib/statusTone';
import { useListDetail } from '../../../lib/useListDetail';
import { useLoad } from '../../../lib/useLoad';
import { ACCOUNT_PATH } from '../paths';
import { ReviewDetail } from './ReviewDetail';
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
      // The live row has no report state (A12: not readable from the table) and no booking: read again.
      onChange: refresh,
      onResync: refresh,
    });
  }, [shopId, replace, refresh]);

  const isColleague = useIsColleague();
  const { pathname } = useLocation();
  const reviews = state.status === 'ready' ? state.data.reviews : null;
  const summary = reviews ? reviewSummary(reviews) : null;
  const { wide, selectedId, open, select } = useListDetail((reviews ?? []).map((r) => r.id), 'recenzie');
  const chosen = reviews?.find((r) => r.id === selectedId) ?? null;

  const header = (
    <>
      <PageHeader back={{ to: ACCOUNT_PATH, label: t('nav.account') }} title={t('reviews.title')} />
      {isColleague && <p className={styles.muted}>{t('reviews.staffNote')}</p>}
      {reviews && summary && reviews.length > 0 && (
        <Card className={styles.summary}>
          <span className={styles.average}>{summary.average === null ? '–' : formatRating(lang, summary.average)}</span>
          <div className={styles.summaryText}>
            {summary.average !== null && <Stars value={summary.average} size={18} />}
            <span className={styles.muted}>{plural(lang, 'unit.reviews', summary.count)}</span>
          </div>
        </Card>
      )}
    </>
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('reviews.loadError')} onRetry={reload} />;
  else if (reviews && reviews.length === 0) list = <EmptyState icon={Star} title={t('reviews.empty')} body={t('reviews.emptyBody')} />;
  else if (reviews)
    list = (
      <ListRows label={t('reviews.title')}>
        {reviews.map((r) => {
          const name = r.client_display_name.trim() || t('reviews.deletedClient');
          const removed = r.removed_at !== null || r.report_status === 'removed';
          return (
            <ListRow
              key={r.id}
              icon={<ShopAvatar name={name} logoUrl={null} size={36} />}
              title={name}
              detail={[formatDayMonth(lang, new Date(r.created_at)), r.text].filter(Boolean).join(' · ')}
              status={
                <>
                  <Stars value={r.rating} size={14} />
                  {r.report_status === 'pending' && <StatusPill tone={toneOf('amber')}>{t('reviews.reported')}</StatusPill>}
                  {removed && <StatusPill tone={toneOf('grey')}>{t('reviews.removed')}</StatusPill>}
                </>
              }
              attention={r.reply === null && !removed}
              selected={wide && r.id === selectedId}
              onSelect={() => select(r.id)}
            />
          );
        })}
      </ListRows>
    );

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={pathname}
        backLabel={t('reviews.title')}
        header={header}
        list={list}
        detail={chosen && <ReviewDetail key={chosen.id} review={chosen} onChanged={replace} onStale={refresh} />}
      />
    </div>
  );
}
