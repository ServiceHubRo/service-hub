import { Star } from 'lucide-react';
import { useCallback } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useSession } from '../../app/sessionContext';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { buttonClass } from '../../components/buttonClass';
import { Card } from '../../components/Card';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { isShopId, rememberShop, shopLinkPreview } from '../../data/shopLink';
import { useI18n } from '../../i18n/context';
import { formatRating } from '../../i18n/format';
import { plural } from '../../i18n/translate';
import { useLoad } from '../../lib/useLoad';
import { AuthLayout } from '../auth/AuthLayout';
import { signUpPath } from '../auth/paths';
import { shopPath } from '../client/paths';
import styles from './BookingLink.module.css';

/**
 * /atelier/:shopId — the shop's own link (T31b), sent by the shop to its clients or scanned from
 * its poster. A client goes straight to the shop's page; a visitor sees the shop and makes an
 * account or signs in, then lands there.
 */
export function ShopLinkScreen() {
  const { t, lang } = useI18n();
  const shopId = useParams().shopId ?? '';
  const session = useSession();
  const valid = isShopId(shopId);
  const load = useCallback(() => (valid ? shopLinkPreview(shopId) : Promise.resolve(null)), [valid, shopId]);
  const { state, reload } = useLoad(load);

  let body;
  if (state.status === 'loading' || session.status === 'loading') body = <SkeletonList count={1} />;
  else if (state.status === 'error') body = <LoadError message={t('sl.loadError')} onRetry={reload} />;
  else if (!state.data) {
    body = (
      <>
        <Banner tone="warning">{t('sl.invalid')}</Banner>
        <Link to="/" className={buttonClass('secondary', true)}>
          {t('app.title')}
        </Link>
      </>
    );
  } else {
    const shop = state.data;
    const signedIn = session.status === 'signedIn';
    if (signedIn && session.role === 'client') return <Navigate to={shopPath(shop.id)} replace />;
    const from = { from: shopPath(shop.id) };
    body = (
      <>
        <Card className={styles.card}>
          <p className={styles.shop}>{shop.name}</p>
          <p className={styles.why}>{[shop.street, shop.city].filter(Boolean).join(', ')}</p>
          <p className={styles.why}>
            {shop.rating !== null && shop.review_count > 0 ? (
              <>
                <Star size={14} aria-hidden="true" /> {formatRating(lang, shop.rating)} ·{' '}
                {plural(lang, 'unit.reviews', shop.review_count)}
              </>
            ) : (
              t('rating.none')
            )}
          </p>
        </Card>
        {signedIn ? (
          <>
            <Banner tone="info">{t('sl.otherRole')}</Banner>
            <Button block onClick={() => void session.signOut()}>
              {t('nav.logout')}
            </Button>
          </>
        ) : (
          <>
            <p className={styles.why}>{t('sl.why')}</p>
            <div className={styles.buttons}>
              <Link
                to={signUpPath('client')}
                state={from}
                className={buttonClass('primary', true)}
                onClick={() => rememberShop(shop.id)}
              >
                {t('lk.signup')}
              </Link>
              <Link to="/intra" state={from} className={buttonClass('secondary', true)} onClick={() => rememberShop(shop.id)}>
                {t('lk.signin')}
              </Link>
            </div>
          </>
        )}
      </>
    );
  }

  const title = state.status === 'ready' && state.data ? t('sl.title', { shop: state.data.name }) : t('sl.titleFallback');
  return (
    <AuthLayout title={title}>
      <div className={styles.buttons}>
        <h1 className={styles.shop}>{title}</h1>
        {body}
      </div>
    </AuthLayout>
  );
}
