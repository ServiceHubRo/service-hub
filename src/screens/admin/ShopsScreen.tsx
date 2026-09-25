import { SearchX, Store } from 'lucide-react';
import { useDeferredValue, useMemo } from 'react';
import { Button } from '../../components/Button';
import { Chip, ChipRow } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { SkeletonList } from '../../components/Skeleton';
import { fetchShops, type AdminShopRow } from '../../data/admin';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { filterShops, isShopFilter, SHOP_FILTERS } from '../../lib/admin';
import { formatPhone } from '../../lib/validators';
import { ExportButton } from './ExportButton';
import { RowLink, ShopStatePill, Verified } from './parts';
import { adminShopPath } from './paths';
import { useLiveData } from './useLiveData';
import { useUrlParams } from './useUrlParams';
import { day } from './format';
import styles from './admin.module.css';

const LIVE = [{ table: 'shops' }, { table: 'subscriptions' }, { table: 'profiles' }];

/**
 * Service-uri (FR §5.2, P20): every shop with its account id, city, email and phone verification,
 * state, created and last active; search and state chips in the address (?q=&stare=). Live.
 */
export function ShopsScreen() {
  const { t, lang } = useI18n();
  const { state, reload } = useLiveData(fetchShops, LIVE, 'admin-shops');
  const { params, setParam, text, setText } = useUrlParams();
  const filterParam = params.get('stare');
  const filter = isShopFilter(filterParam) ? filterParam : 'all';
  const query = useDeferredValue(text);
  const all = state.status === 'ready' ? state.data : null;
  const shown = useMemo(() => (all ? filterShops(all, query, filter) : []), [all, query, filter]);

  return (
    <div className={styles.page}>
      <div>
        <h1>{t('nav.admin.shops')}</h1>
        {all && <p className={styles.sub}>{plural(lang, 'unit.shops', shown.length)}</p>}
      </div>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {all && all.length === 0 && <EmptyState icon={Store} title={t('admin.shops.empty')} />}
      {all && all.length > 0 && (
        <>
          <div className={styles.controls}>
            <SearchField
              id="admin-shops-q"
              label={t('admin.shops.search')}
              placeholder={t('admin.shops.search')}
              value={text}
              onChange={setText}
              onClear={() => {
                setText('');
                setParam({ q: null });
              }}
              clearLabel={t('admin.search.clear')}
            />
            <ChipRow label={t('admin.filter.state')}>
              {SHOP_FILTERS.map((f) => (
                <Chip key={f} selected={filter === f} onClick={() => setParam({ stare: f === 'all' ? null : f })}>
                  {t(`admin.shopFilter.${f}`)}
                </Chip>
              ))}
            </ChipRow>
            <div className={styles.toolbar}>
              <ExportButton<AdminShopRow>
                kind="shops"
                filters={{ q: query || undefined, state: filter === 'all' ? undefined : filter }}
                narrow={(rows) => filterShops(rows, query, filter)}
              />
            </div>
          </div>
          {shown.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={t('admin.noResults')}
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    setText('');
                    setParam({ q: null, stare: null });
                  }}
                >
                  {t('admin.clearFilters')}
                </Button>
              }
            />
          ) : (
            <ul className={styles.list}>
              {shown.map((s) => (
                <li key={s.id}>
                  <RowLink to={adminShopPath(s.id)}>
                    <span className={styles.rowTop}>
                      <span className={styles.rowTitle}>{s.name}</span>
                      <ShopStatePill state={s.state} />
                    </span>
                    <span className={styles.rowMeta}>
                      <span className={styles.id}>{s.display_id}</span>
                      <span>{s.city}</span>
                      {s.email && <span>{s.email}</span>}
                      {s.phone && <span className="mono">{formatPhone(s.phone)}</span>}
                    </span>
                    <span className={styles.checks}>
                      <Verified ok={s.email_verified} label={t('admin.email')} />
                      <Verified ok={s.phone_verified} label={t('admin.phone')} />
                    </span>
                    <span className={styles.rowMeta}>
                      <span>{t('admin.createdOn', { date: day(lang, s.created_at) })}</span>
                      <span>{t('admin.lastActive', { date: s.last_active_at ? day(lang, s.last_active_at) : t('admin.never') })}</span>
                    </span>
                  </RowLink>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
