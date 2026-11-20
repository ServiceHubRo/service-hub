import { Store, Wrench } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { buttonClass } from '../../../components/buttonClass';
import { EmptyState } from '../../../components/EmptyState';
import { DetailPane, ListDetailLayout } from '../../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../../components/ListRow';
import { LoadError } from '../../../components/LoadError';
import { PageHeader } from '../../../components/PageHeader';
import { ServiceIcon } from '../../../components/ServiceIcon';
import { toRpcError } from '../../../data/rpc';
import { fetchShopPage } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { plural } from '../../../i18n/translate';
import { useListDetail } from '../../../lib/useListDetail';
import { useLoad } from '../../../lib/useLoad';
import { SEARCH_PATH, shopPath, shopServicesPath } from '../paths';
import { groupServices, serviceName } from './serviceGroups';
import styles from './shopReviews.module.css';

/**
 * What a shop does, on a screen of its own (C9, Eduard, 21 Nov 2026), like its reviews: the categories as
 * rows on the left, the chosen category's services on the right. The price is set by the quote.
 */
export function ShopServicesPage() {
  const { t, lang } = useI18n();
  const { shopId = '' } = useParams();
  const load = useCallback(() => fetchShopPage(shopId), [shopId]);
  const { state, reload } = useLoad(load);

  const page = state.status === 'ready' ? state.data : null;
  const groups = useMemo(() => (page ? groupServices(page.services, lang) : []), [page, lang]);
  const { wide, selectedId, open, select } = useListDetail(
    groups.map((g) => g.key),
    'categorie',
  );
  const chosen = groups.find((g) => g.key === selectedId) ?? null;
  const back = { to: shopPath(shopId), label: page?.shop.name ?? t('shop.allShops') };

  const header = (
    <>
      <PageHeader back={back} title={t('shop.services')} subtitle={page?.shop.name} />
      {page && <p className={styles.muted}>{t('shop.priceNote')}</p>}
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
  else if (groups.length === 0) list = <EmptyState icon={Wrench} title={t('shop.noServices')} />;
  else
    list = (
      <ListRows label={t('shop.services')}>
        {groups.map((g) => (
          <ListRow
            key={g.key}
            icon={<ServiceIcon name={g.items[0]?.icon} />}
            title={g.name}
            detail={plural(lang, 'unit.services', g.items.length)}
            selected={wide && g.key === selectedId}
            onSelect={() => select(g.key)}
          />
        ))}
      </ListRows>
    );

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={shopServicesPath(shopId)}
        backLabel={t('shop.services')}
        header={header}
        list={list}
        detail={
          chosen && (
            <DetailPane
              key={chosen.key}
              id={chosen.key}
              icon={<ServiceIcon name={chosen.items[0]?.icon} />}
              title={chosen.name}
              detail={plural(lang, 'unit.services', chosen.items.length)}
            >
              <ul className={styles.serviceList} aria-label={chosen.name}>
                {chosen.items.map((s) => (
                  <li key={s.id} className={styles.service}>
                    <ServiceIcon name={s.icon} className={styles.serviceIcon} />
                    {serviceName(s, lang)}
                  </li>
                ))}
              </ul>
            </DetailPane>
          )
        }
      />
    </div>
  );
}
