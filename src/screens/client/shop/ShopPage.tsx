import { CalendarPlus, Globe, MapPin, Phone, Store } from 'lucide-react';
import { useCallback, type ReactNode } from 'react';
import { Link, useLocation as useRouterLocation, useParams } from 'react-router-dom';
import { BackLink } from '../../../components/BackLink';
import { Banner } from '../../../components/Banner';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { FavoriteButton } from '../../../components/FavoriteButton';
import { LoadError } from '../../../components/LoadError';
import { ServiceIcon } from '../../../components/ServiceIcon';
import { ShopAvatar } from '../../../components/ShopAvatar';
import { SkeletonList } from '../../../components/Skeleton';
import { Stars } from '../../../components/Stars';
import { toRpcError } from '../../../data/rpc';
import { fetchShopPage, type ShopPage as ShopPageData, type ShopPageService } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { formatDateRange, formatDayMonth, formatDistance, formatMoney, formatRating } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import { plural } from '../../../i18n/translate';
import { distanceTo } from '../../../lib/geo';
import { groupHours, type HoursRow } from '../../../lib/hours';
import { useLocation } from '../../../lib/location';
import { useLoad } from '../../../lib/useLoad';
import { bookingPath, SEARCH_PATH, type ShopLinkState } from '../paths';
import styles from './ShopPage.module.css';

/**
 * The shop page a client opens from search (FR §3.2, P11b): who they are, when they work, what
 * they do, what the inspection costs, what other clients said — and "Programează-te".
 * Read in one call with public columns only; fiscal data never reaches this screen.
 */
export function ShopPage() {
  const { t } = useI18n();
  const { shopId = '' } = useParams();
  const routerState = useRouterLocation().state as ShopLinkState | null;
  const back = routerState?.backTo ?? SEARCH_PATH;
  const backLabel = routerState?.backLabel === 'favorites' ? t('favorites.title') : t('shop.allShops');

  const load = useCallback(() => fetchShopPage(shopId), [shopId]);
  const { state, reload, setData } = useLoad(load);

  return (
    <div className={styles.page}>
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
        <ShopDetails page={state.data} onFavorite={(on) => setData((p) => ({ ...p, is_favorite: on }))} />
      )}
    </div>
  );
}

function ShopDetails({ page, onFavorite }: { page: ShopPageData; onFavorite: (on: boolean) => void }) {
  const { t, lang } = useI18n();
  const { coords } = useLocation();
  const { shop, rating } = page;
  const distance = distanceTo(coords, shop);
  const address = [shop.street, shop.city].filter(Boolean).join(', ');

  return (
    <>
      <header className={styles.header}>
        <ShopAvatar name={shop.name} logoUrl={shop.logo_url} size={56} />
        <div className={styles.headText}>
          <h1 className={styles.name}>{shop.name}</h1>
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
        </div>
        <FavoriteButton shopId={shop.id} shopName={shop.name} on={page.is_favorite} onChange={onFavorite} />
      </header>

      <p className={styles.address}>
        <MapPin size={15} aria-hidden="true" />
        <span>
          {address}
          {distance !== null && <span className={styles.distance}> · {t('shop.distance', { distance: formatDistance(lang, distance) })}</span>}
        </span>
      </p>

      {shop.description && <p className={styles.description}>{shop.description}</p>}

      {!page.bookable && <Banner tone="warning">{t('shop.notBookable')}</Banner>}

      <Card className={styles.info}>
        <InfoRow label={t('shop.hours')}>
          <HoursList rows={groupHours(page.hours)} />
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

      <h2 className={styles.sectionTitle}>{t('shop.services')}</h2>
      <ServiceGroups services={page.services} />
      <p className={styles.muted}>{t('shop.priceNote')}</p>

      {page.bookable && (
        <Link to={bookingPath(shop.id)} className={buttonClass('primary', true, styles.book)}>
          <CalendarPlus size={18} aria-hidden="true" />
          {t('shop.book')}
        </Link>
      )}

      {page.reviews.length > 0 && (
        <section className={styles.reviews} aria-labelledby="reviews-title">
          <h2 id="reviews-title" className={styles.sectionTitle}>
            {t('shop.reviews')}
          </h2>
          <ul className={styles.plainList}>
            {page.reviews.map((r) => (
              <li key={r.id}>
                <Card className={styles.review}>
                  <div className={styles.reviewHead}>
                    <span className={styles.reviewer}>{r.display_name}</span>
                    <span className={styles.muted}>{formatDayMonth(lang, new Date(r.created_at))}</span>
                  </div>
                  <Stars value={r.rating} />
                  {r.text && <p className={styles.reviewText}>{r.text}</p>}
                  {r.reply && (
                    <Card inset className={styles.reply}>
                      <p className={styles.replyLabel}>{t('shop.reply')}</p>
                      <p className={styles.reviewText}>{r.reply}</p>
                    </Card>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
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

function HoursList({ rows }: { rows: HoursRow[] }) {
  const { t } = useI18n();
  const day = (d: number) => t(`weekday.short.${d}` as MessageKey);
  return (
    <ul className={styles.hours}>
      {rows.map((r) => (
        <li key={r.days.join('-')} className={styles.hoursRow}>
          <span className={styles.days}>{r.days.length === 1 ? day(r.days[0]!) : `${day(r.days[0]!)} – ${day(r.days.at(-1)!)}`}</span>
          <span className={r.closed ? styles.closed : 'mono'}>{r.closed ? t('shop.closed') : `${r.open} – ${r.close}`}</span>
        </li>
      ))}
    </ul>
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

function ServiceGroups({ services }: { services: ShopPageService[] }) {
  const { lang } = useI18n();
  const groups: { key: string; name: string; items: ShopPageService[] }[] = [];
  for (const s of services) {
    const last = groups.at(-1);
    if (last && last.key === s.category_key) last.items.push(s);
    else groups.push({ key: s.category_key, name: lang === 'ro' ? s.category_ro : s.category_en, items: [s] });
  }
  return (
    <div className={styles.serviceGroups}>
      {groups.map((g) => (
        <div key={g.key}>
          <h3 className={styles.categoryTitle}>{g.name}</h3>
          <ul className={styles.services}>
            {g.items.map((s) => (
              <li key={s.id} className={styles.service}>
                <ServiceIcon name={s.icon} className={styles.serviceIcon} />
                {lang === 'ro' ? s.name_ro : s.name_en}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Links typed without a scheme ("atelier.ro") open as https. */
function websiteUrl(site: string): string {
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}
