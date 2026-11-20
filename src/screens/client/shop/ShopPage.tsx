import { CalendarPlus, Globe, MapPin, Navigation, Phone, Store, Wrench } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, type ReactNode } from 'react';
import { Link, useLocation as useRouterLocation, useParams, useSearchParams } from 'react-router-dom';
import { BackLink } from '../../../components/BackLink';
import { Banner } from '../../../components/Banner';
import { BottomBar } from '../../../components/BottomBar';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { FavoriteButton } from '../../../components/FavoriteButton';
import { FreePlaceNote } from '../../../components/FreePlaceNote';
import { LoadError } from '../../../components/LoadError';
import { OfferNote } from '../../../components/OfferNote';
import { PhotoGallery } from '../../../components/PhotoGallery';
import { FounderBadge } from '../../../components/FounderBadge';
import { useOfferText } from '../../../lib/useOfferText';
import { ShopAvatar } from '../../../components/ShopAvatar';
import { SkeletonList } from '../../../components/Skeleton';
import { Stars } from '../../../components/Stars';
import { subscribeRows } from '../../../data/realtime';
import { toRpcError } from '../../../data/rpc';
import { fetchShopPage, type ShopPage as ShopPageData } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { useEmbedded } from '../../../lib/embedded';
import { formatDate, formatDateRange, formatDistance, formatMoney, formatRating } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import { plural } from '../../../i18n/translate';
import { AMENITIES, AMENITY_ICONS } from '../../../lib/amenities';
import { resolveDay } from '../../../lib/freePlace';
import { distanceTo } from '../../../lib/geo';
import { directionsUrl } from '../../../lib/maps';
import { HoursTable } from '../../../components/HoursTable';
import { useLocation } from '../../../lib/location';
import { useLoad } from '../../../lib/useLoad';
import { bookingPath, SEARCH_PATH, shopReviewsPath, shopServicesPath, type ShopLinkState } from '../paths';
import styles from './ShopPage.module.css';

/** The small map under the address (T28b), loaded only for a shop with coordinates. */
const ShopsMap = lazy(() => import('../../../components/map/ShopsMap'));

/**
 * The shop page a client opens from search (FR §3.2, P11b): who they are, when they work, what
 * they do, what the inspection costs, what other clients said — and "Programează-te".
 * Read in one call with public columns only; fiscal data never reaches this screen.
 */
export function ShopPage({ shopId: panelShopId, linkState }: { shopId?: string; linkState?: ShopLinkState } = {}) {
  const { t } = useI18n();
  // Beside the search results (a laptop, C9) the page is the right-hand panel: the shop is the one
  // chosen in the list, the links to its reviews and services lead back to the search.
  const embedded = useEmbedded();
  const params0 = useParams();
  const shopId = panelShopId ?? params0.shopId ?? '';
  const routerState = useRouterLocation().state as ShopLinkState | null;
  const back = routerState?.backTo ?? SEARCH_PATH;
  const backLabel = routerState?.backLabel === 'favorites' ? t('favorites.title') : t('shop.allShops');

  // Opened from a search for a day (T28a): the free place shown is on that day.
  const [params] = useSearchParams();
  const day = resolveDay(params.get('zi'));
  const load = useCallback(() => fetchShopPage(shopId, day), [shopId, day]);
  const { state, reload, setData } = useLoad(load);

  // Reviews and replies arrive live (T11): a change to this shop's reviews reads the page again
  // quietly; the favorite heart keeps what is on screen.
  const ready = state.status === 'ready';
  useEffect(() => {
    if (!ready || !shopId) return;
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        fetchShopPage(shopId, day).then(
          (page) => setData((prev) => ({ ...page, is_favorite: prev.is_favorite })),
          () => {},
        );
      }, 200);
    };
    const unsubscribe = subscribeRows({
      channel: `shop-page-reviews:${shopId}`,
      table: 'reviews',
      filter: `shop_id=eq.${shopId}`,
      onChange: refresh,
      onResync: () => {}, // the page was just read; only later changes matter here
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [ready, shopId, day, setData]);

  return (
    <div className={styles.page} data-fill-screen={embedded ? undefined : true}>
      <BackLink to={back} label={backLabel} />
      {state.status === 'loading' && <SkeletonList count={3} />}
      {state.status === 'error' &&
        (toRpcError(state.error).code === 'shop_not_found' ? (
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
        ))}
      {state.status === 'ready' && (
        <ShopDetails page={state.data} day={day} linkState={linkState} onFavorite={(on) => setData((p) => ({ ...p, is_favorite: on }))} />
      )}
    </div>
  );
}

function ShopDetails({
  page,
  day,
  linkState,
  onFavorite,
}: {
  page: ShopPageData;
  day: string | null;
  linkState?: ShopLinkState;
  onFavorite: (on: boolean) => void;
}) {
  const Title = useEmbedded() ? 'h2' : 'h1';
  const { t, lang } = useI18n();
  const offerText = useOfferText();
  const { coords } = useLocation();
  const { shop, rating } = page;
  const distance = distanceTo(coords, shop);
  const hasReviews = page.reviews.length > 0;
  const address = [shop.street, shop.city].filter(Boolean).join(', ');

  return (
    <>
      {/* One column the whole width (T58, Eduard 30 Oct: the long list of services left the shop's
          column empty below); the parts inside lay out across the width. */}
      <div className={styles.columns}>
        <div className={styles.column}>
          <header data-ui="shop-header" className={styles.header}>
            <ShopAvatar name={shop.name} logoUrl={shop.logo_url} size={56} />
            <div className={styles.headText}>
              <Title className={styles.name}>{shop.name}</Title>
              {page.founder && (
                <p className={styles.founder}>
                  <FounderBadge withHint />
                </p>
              )}
              {hasReviews && rating.review_count > 0 && rating.average !== null ? (
                <Link to={shopReviewsPath(shop.id)} state={linkState} className={`${styles.rating} ${styles.ratingButton}`}>
                  <Stars value={rating.average} />
                  <span className={styles.ratingValue}>{formatRating(lang, rating.average)}</span>
                  <span className={styles.ratingLink}>· {plural(lang, 'unit.reviews', rating.review_count)}</span>
                </Link>
              ) : (
                <p className={styles.rating}>
                  {rating.review_count > 0 && rating.average !== null ? (
                    <>
                      <Stars value={rating.average} />
                      <span className={styles.ratingValue}>{formatRating(lang, rating.average)}</span>
                      <span>· {plural(lang, 'unit.reviews', rating.review_count)}</span>
                    </>
                  ) : (
                    <span>{t('rating.none')}</span>
                  )}
                </p>
              )}
            </div>
            <FavoriteButton shopId={shop.id} shopName={shop.name} on={page.is_favorite} onChange={onFavorite} />
          </header>

          <PhotoGallery photos={page.photos ?? []} shopName={shop.name} />

          <p className={styles.address}>
            <MapPin size={15} aria-hidden="true" />
            <span>
              {address}
              {distance !== null && <span className={styles.distance}> · {t('shop.distance', { distance: formatDistance(lang, distance) })}</span>}
            </span>
            <a className={styles.directions} href={directionsUrl(shop)} target="_blank" rel="noopener noreferrer">
              <Navigation size={14} aria-hidden="true" />
              {t('shop.directions')}
            </a>
          </p>

          {shop.description && <p className={styles.description}>{shop.description}</p>}

          {!page.bookable && <Banner tone="warning">{t('shop.notBookable')}</Banner>}
          {page.bookable && (
            <div className={styles.freePlace}>
              {page.free || shop.auto_confirm || page.response ? (
                <FreePlaceNote free={page.free} instant={shop.auto_confirm} response={page.response} />
              ) : null}
              {page.free ? (
                // Straight to that day and time; "Programează-te" below still lets the client choose.
                <Link to={`${bookingPath(shop.id)}?zi=${page.free.date}&ora=${page.free.slot}`} className={buttonClass('secondary', false, styles.freeBook)}>
                  {t('free.bookThis', { when: `${formatDate(lang, page.free.date)}, ${page.free.slot}` })}
                </Link>
              ) : (
                <p className={styles.muted}>{t(day ? 'free.noneDay' : 'free.none')}</p>
              )}
            </div>
          )}
          {page.bookable && page.offers.newClient && (
            <OfferNote>
              <strong>{t('offer.title')}</strong> · {offerText.newClientPage(page.offers.newClient)}
              {page.offers.newClient.services && <> {offerText.services(page.offers.newClient)}</>}
            </OfferNote>
          )}
          {page.bookable && page.offers.quietDay && (
            <OfferNote>
              <strong>{t('offer.quiet.title')}</strong> · {offerText.quietPage(page.offers.quietDay)}
            </OfferNote>
          )}

          <Card className={styles.info}>
            <InfoRow label={t('shop.hours')}>
              <HoursTable hours={page.hours} className={styles.hoursEnd} />
            </InfoRow>
            {page.closures.length > 0 && (
              <InfoRow label={t('shop.closures')}>
                <ul className={styles.plainList}>
                  {page.closures.map((c) => (
                    <li key={`${c.start_date}-${c.end_date}`}>
                      <span className="mono">{formatDateRange(lang, c.start_date, c.end_date)}</span>
                      {c.label && <span className={styles.muted}> · {c.label}</span>}
                    </li>
                  ))}
                </ul>
              </InfoRow>
            )}
            {(shop.amenities ?? []).length > 0 && (
              <InfoRow label={t('shop.amenities')}>
                <ul className={styles.amenities}>
                  {AMENITIES.filter((a) => shop.amenities.includes(a)).map((a) => {
                    const Icon = AMENITY_ICONS[a];
                    return (
                      <li key={a}>
                        <Icon size={15} aria-hidden="true" />
                        {t(`amenity.${a}` as MessageKey)}
                      </li>
                    );
                  })}
                </ul>
              </InfoRow>
            )}
            <InfoRow label={t('shop.capacity')}>
              <span className="mono">{shop.daily_capacity}</span>
            </InfoRow>
            {shop.min_notice_hours > 0 && (
              <InfoRow label={t('shop.notice')}>{t('shop.noticeValue', { hours: plural(lang, 'unit.hours', shop.min_notice_hours) })}</InfoRow>
            )}
            {shop.phone && (
              <InfoRow label={t('shop.phone')}>
                <PhoneLinks phones={[shop.phone, shop.phone2]} shopName={shop.name} />
              </InfoRow>
            )}
            {shop.website && (
              <InfoRow label={t('shop.website')}>
                <a className={styles.link} href={websiteUrl(shop.website)} target="_blank" rel="noopener noreferrer">
                  <Globe size={14} aria-hidden="true" />
                  {shop.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              </InfoRow>
            )}
            {shop.inspection_fee > 0 && (
              <InfoRow label={t('shop.fee')} note={t('shop.feeNote')}>
                <span className="mono">{formatMoney(lang, shop.inspection_fee)}</span>
              </InfoRow>
            )}
          </Card>

          {shop.latitude !== null && shop.longitude !== null && (
            <Suspense fallback={<div className={styles.mapLoading} />}>
              <ShopsMap
                compact
                label={t('shop.map', { name: shop.name })}
                shops={[{ id: shop.id, name: shop.name, latitude: shop.latitude, longitude: shop.longitude }]}
              />
            </Suspense>
          )}

        </div>
        <div className={styles.column}>
        </div>
      </div>

      {/* Always at hand (asked at testing): at the bottom, just above the menu. The services (a screen of their
          own, C9) on the left, "Programează-te" on the right, the same size (Eduard, 21 Nov 2026). */}
      <BottomBar>
        <div className={`${styles.bookRow} ${page.bookable ? '' : styles.bookRowSingle}`}>
          <Link to={shopServicesPath(shop.id)} state={linkState} className={buttonClass('secondary', true, styles.book)}>
            <Wrench size={18} aria-hidden="true" />
            {t('shop.services')}
          </Link>
          {page.bookable && (
            <Link
              to={day ? `${bookingPath(shop.id)}?zi=${day}` : bookingPath(shop.id)}
              state={linkState}
              className={buttonClass('primary', true, styles.book)}
            >
              <CalendarPlus size={18} aria-hidden="true" />
              {t('shop.book')}
            </Link>
          )}
        </div>
      </BottomBar>
    </>
  );
}

function InfoRow({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className={styles.infoRow}>
      <div className={styles.infoLine}>
        <span className={styles.infoLabel}>{label}</span>
        <div className={styles.infoValue}>{children}</div>
      </div>
      {note && <p className={styles.infoNote}>{note}</p>}
    </div>
  );
}

function PhoneLinks({ phones, shopName }: { phones: (string | null)[]; shopName: string }) {
  const { t } = useI18n();
  return (
    <span className={styles.phones}>
      {phones.filter((p): p is string => Boolean(p)).map((p) => (
        <a key={p} className={styles.phone} href={`tel:${p.replace(/[^\d+]/g, '')}`} aria-label={t('shop.call', { name: shopName, phone: p })}>
          <Phone size={14} aria-hidden="true" />
          {p}
        </a>
      ))}
    </span>
  );
}

/** Links typed without a scheme ("atelier.ro") open as https. */
function websiteUrl(site: string): string {
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}
