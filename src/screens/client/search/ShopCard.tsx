import { ChevronRight, MapPin } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { FavoriteButton } from '../../../components/FavoriteButton';
import { FreePlaceNote } from '../../../components/FreePlaceNote';
import { OfferNote } from '../../../components/OfferNote';
import { ShopAvatar } from '../../../components/ShopAvatar';
import { Stars } from '../../../components/Stars';
import type { ShopSearchResult } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { formatDistance, formatRating } from '../../../i18n/format';
import { plural } from '../../../i18n/translate';
import { shopPath, shopReviewsPath, type ShopLinkState } from '../paths';
import styles from './ShopCard.module.css';

export interface ShopCardProps {
  shop: ShopSearchResult;
  distanceKm: number | null;
  /** Where "Înapoi" on the shop page leads (this list, with its filters). */
  back: ShopLinkState;
  onFavorite: (shopId: string, on: boolean) => void;
  /** The day the search asked for (`YYYY-MM-DD`): the shop page opens on it. */
  day?: string | null;
}

/** One search result (FR §3.1): one shop per row, whole card opens the shop page. */
export function ShopCard({ shop, distanceKm, back, onFavorite, day }: ShopCardProps) {
  const { t, lang } = useI18n();
  const matched = lang === 'ro' ? shop.matched_service_ro : shop.matched_service_en;
  const navigate = useNavigate();
  const hasReviews = shop.review_count > 0 && shop.average !== null;

  return (
    <article className={styles.card}>
      <Link
        to={day ? `${shopPath(shop.shop_id)}?zi=${day}` : shopPath(shop.shop_id)}
        state={back}
        className={styles.link}
        onClick={(e) => {
          // A tap on the stars opens the shop page at its reviews; anywhere else, at the top.
          if (hasReviews && (e.target as HTMLElement).closest('[data-reviews]')) {
            e.preventDefault();
            navigate(shopReviewsPath(shop.shop_id), { state: back });
          }
        }}
      >
        <ShopAvatar name={shop.name} logoUrl={shop.logo_url} />
        <span className={styles.body}>
          <span className={styles.name}>{shop.name}</span>
          <span className={styles.meta} data-reviews="">
            {hasReviews ? (
              <>
                <Stars value={Number(shop.average)} />
                <span className={styles.rating}>{formatRating(lang, Number(shop.average))}</span>
                <span>· {plural(lang, 'unit.reviews', shop.review_count)}</span>
              </>
            ) : (
              <span>{t('rating.none')}</span>
            )}
          </span>
          <span className={styles.meta}>
            <span>{shop.city}</span>
            {distanceKm !== null && (
              <span className={styles.distance}>
                <MapPin size={13} aria-hidden="true" />
                {formatDistance(lang, distanceKm)}
              </span>
            )}
            <span>· {plural(lang, 'unit.services', shop.service_count)}</span>
          </span>
          {(shop.free || shop.auto_confirm || shop.response) && (
            <span className={styles.free}>
              <FreePlaceNote free={shop.free} instant={shop.auto_confirm} response={shop.response} />
            </span>
          )}
          {matched && <span className={styles.offers}>{t('search.offers', { service: matched })}</span>}
          {shop.offer !== null ? (
            <span className={styles.newClient}>
              <OfferNote compact>{t('offer.card', { n: shop.offer })}</OfferNote>
            </span>
          ) : shop.loyalty !== null ? (
            <span className={styles.newClient}>
              <OfferNote compact>{t('loyalty.card', { n: shop.loyalty })}</OfferNote>
            </span>
          ) : shop.loyalty_offered ? (
            <span className={styles.newClient}>
              <OfferNote compact>{t('loyalty.offered')}</OfferNote>
            </span>
          ) : null}
        </span>
        <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
      </Link>
      <div className={styles.fav}>
        <FavoriteButton
          shopId={shop.shop_id}
          shopName={shop.name}
          on={shop.is_favorite}
          onChange={(on) => onFavorite(shop.shop_id, on)}
        />
      </div>
    </article>
  );
}
