import { Award, CircleCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { NAV } from '../../../app/roles';
import { BackLink } from '../../../components/BackLink';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { fetchMyLoyalty, type MyLoyalty, type MyLoyaltyShop } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { plural } from '../../../i18n/translate';
import { useLoad } from '../../../lib/useLoad';
import { SEARCH_PATH, shopPath } from '../paths';
import styles from './loyalty.module.css';

/** Jobs at the same shop a level starts at (the database's loyalty_level_for). */
const LEVEL_JOBS = { 1: 3, 2: 6 } as const;

/**
 * Cont → Fidelitate (T28c): for every shop with a finished job in the last two years, the jobs there,
 * the level, what is left to the next one and the discount that shop gives. Only jobs at the same
 * shop count; the levels are computed in the database.
 */
export function LoyaltyScreen() {
  const { t } = useI18n();
  const { state, reload } = useLoad(fetchMyLoyalty);

  return (
    <div className={styles.page}>
      <BackLink to={NAV.client.account.path} label={t('nav.account')} />
      <div>
        <h1>{t('loyalty.screen')}</h1>
        <p className={styles.sub}>{t('loyalty.intro')}</p>
      </div>
      {state.status === 'loading' && <SkeletonList count={2} />}
      {state.status === 'error' && <LoadError message={t('loyalty.loadError')} onRetry={reload} />}
      {state.status === 'ready' && <Loaded data={state.data} />}
    </div>
  );
}

function Loaded({ data }: { data: MyLoyalty }) {
  const { t } = useI18n();
  return (
    <>
      {data.shops.length === 0 ? (
        <EmptyState
          icon={Award}
          title={t('loyalty.empty')}
          body={t('loyalty.emptyBody')}
          action={
            <Link to={SEARCH_PATH} className={buttonClass('primary')}>
              {t('loyalty.search')}
            </Link>
          }
        />
      ) : (
        <section className={styles.section} aria-labelledby="loyalty-mine">
          <h2 id="loyalty-mine" className={styles.h2}>
            {t('loyalty.mine')}
          </h2>
          <ul className={styles.list}>
            {data.shops.map((s) => (
              <li key={s.shop_id}>
                <ShopLoyalty shop={s} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.section} aria-labelledby="loyalty-how">
        <h2 id="loyalty-how" className={styles.h2}>
          {t('loyalty.how')}
        </h2>
        <ul className={styles.how}>
          {(['loyalty.how1', 'loyalty.how2'] as const).map((key) => (
            <li key={key}>
              <CircleCheck size={18} className={styles.iconOn} aria-hidden="true" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
        <p className={styles.sub}>{t('loyalty.shops', { n: data.offering })}</p>
      </section>
    </>
  );
}

function ShopLoyalty({ shop }: { shop: MyLoyaltyShop }) {
  const { t, lang } = useI18n();
  const next = shop.next_level;
  const goal = next ? LEVEL_JOBS[next] : null;
  const gives = shop.l1 !== null || shop.l2 !== null;
  const nextText =
    next && shop.jobs_to_next !== null ? t('loyalty.next', { jobs: plural(lang, 'unit.jobs', shop.jobs_to_next), level: next }) : null;
  return (
    <Card className={styles.card}>
      <div className={styles.levelRow}>
        <Award size={24} className={shop.level > 0 ? styles.iconOn : styles.iconOff} aria-hidden="true" />
        <div className={styles.shopText}>
          {shop.bookable ? (
            <Link to={shopPath(shop.shop_id)} className={styles.shopName}>
              {shop.name}
            </Link>
          ) : (
            <span className={styles.shopName}>{shop.name}</span>
          )}
          <p className={styles.sub}>
            {shop.level > 0 ? t('loyalty.level', { n: shop.level }) : t('loyalty.level0')} · {t('loyalty.jobs', { n: shop.jobs })}
          </p>
          {shop.percent !== null && <span className={styles.percent}>{t('offer.short', { n: shop.percent })}</span>}
        </div>
      </div>
      {nextText && goal ? (
        <div>
          <p className={styles.next}>{nextText}</p>
          <div
            className={styles.progress}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={goal}
            aria-valuenow={Math.min(shop.jobs, goal)}
            aria-valuetext={nextText}
            aria-label={t('loyalty.progressAt', { level: next!, name: shop.name })}
          >
            <span style={{ width: `${(Math.min(shop.jobs, goal) / goal) * 100}%` }} />
          </div>
        </div>
      ) : (
        <p className={styles.next}>{t('loyalty.top')}</p>
      )}
      {!gives && <p className={styles.sub}>{t('loyalty.noDiscount')}</p>}
    </Card>
  );
}
