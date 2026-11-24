import { SearchX, Store } from 'lucide-react';
import { useDeferredValue, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ChoiceFilters } from '../../components/Filters';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { buttonClass } from '../../components/buttonClass';
import { DetailFacts, DetailPane, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { fetchShops, type AdminShopRow } from '../../data/admin';
import { adminZoneBack } from '../../app/adminZones';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { filterShops, isShopFilter, SHOP_FILTERS } from '../../lib/admin';
import { useListDetail } from '../../lib/useListDetail';
import { formatPhone } from '../../lib/validators';
import { ExportButton } from './ExportButton';
import { ShopStatePill, Verified } from './parts';
import { ADMIN_SHOPS_PATH, adminShopPath } from './paths';
import { useLiveData } from './useLiveData';
import { useUrlParams } from './useUrlParams';
import { day } from './format';
import styles from './admin.module.css';
import { PageHeader } from '../../components/PageHeader';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_SHOPS_PATH);

const LIVE = [{ table: 'shops' }, { table: 'subscriptions' }, { table: 'profiles' }];

/**
 * Service-uri (FR §5.2, P20): every shop with its account id, city, email and phone verification,
 * state, created and last active; search and state chips in the address (?q=&stare=). Live.
 */
export function ShopsScreen() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const { state, reload } = useLiveData(fetchShops, LIVE, 'admin-shops');
  const { params, setParam, text, setText } = useUrlParams();
  const filterParam = params.get('stare');
  const filter = isShopFilter(filterParam) ? filterParam : 'all';
  const query = useDeferredValue(text);
  const all = state.status === 'ready' ? state.data : null;
  const shown = useMemo(() => (all ? filterShops(all, query, filter) : []), [all, query, filter]);

  // Page template A (docs/MODEL_DE_FOLOSIRE.md P8): one row per shop, the chosen one beside the list
  // from 1024 px (in its place below); the whole file is „Deschide fișa”.
  const { wide, selectedId, open, select } = useListDetail(
    shown.map((x) => x.id),
    'unitate',
  );
  const chosen = shown.find((x) => x.id === selectedId) ?? null;

  const header = (
    <>
      <PageHeader back={{ to: ZONE_BACK.to, label: t(ZONE_BACK.label) }} title={t('nav.admin.shops')} subtitle={all ? plural(lang, 'unit.shops', shown.length) : undefined} />
      {all && all.length > 0 && (
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
            <ChoiceFilters
              groups={[
                {
                  key: 'stare',
                  title: t('admin.filter.state'),
                  options: SHOP_FILTERS.map((f) => ({ value: f, label: t(`admin.shopFilter.${f}`) })),
                  value: filter,
                  defaultValue: 'all',
                  onChange: (v) => setParam({ stare: v === 'all' ? null : v }),
                },
              ]}
              end={
                <div className={styles.toolbar}>
                  <ExportButton<AdminShopRow>
                    kind="shops"
                    filters={{ q: query || undefined, state: filter === 'all' ? undefined : filter }}
                    ids={shown.map((r) => r.id)}
                    narrow={(rows) => filterShops(rows, query, filter)}
                  />
                </div>
              }
            />
          </div>
      )}
    </>
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('admin.loadError')} onRetry={reload} />;
  else if (all && all.length === 0) list = <EmptyState icon={Store} title={t('admin.shops.empty')} />;
  else if (shown.length === 0)
    list = (
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
    );
  else
    list = (
      <ListRows label={t('nav.admin.shops')}>
        {shown.map((x) => (
          <ListRow
            key={x.id}
            icon={<Store size={20} />}
            title={x.name}
            detail={[x.display_id, x.city, x.email, x.phone ? formatPhone(x.phone) : null].filter(Boolean).join(' · ')}
            status={<ShopStatePill state={x.state} />}
            selected={wide && x.id === selectedId}
            onSelect={() => select(x.id)}
          />
        ))}
      </ListRows>
    );

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={pathname}
        backLabel={t('nav.admin.shops')}
        header={header}
        list={list}
        detail={chosen && <ShopDetail key={chosen.id} s={chosen} />}
      />
    </div>
  );
}

/** One shop in the list's detail; the whole file (billing, subscription, hours, staff, the log) is „Deschide fișa”. */
function ShopDetail({ s }: { s: AdminShopRow }) {
  const { t, lang } = useI18n();
  return (
    <DetailPane
      id={s.id}
      icon={<Store size={20} />}
      title={s.name}
      detail={[s.display_id, s.city].filter(Boolean).join(' · ')}
      status={<ShopStatePill state={s.state} />}
      actions={
        <Link className={buttonClass('secondary')} to={adminShopPath(s.id)}>
          {t('admin.shops.open')}
        </Link>
      }
    >
      <DetailFacts
        items={[
          { label: t('admin.email'), value: s.email ? <span>{s.email} <Verified ok={s.email_verified} label={t('admin.email')} /></span> : '—' },
          { label: t('admin.phone'), value: s.phone ? <span><span className="mono">{formatPhone(s.phone)}</span> <Verified ok={s.phone_verified} label={t('admin.phone')} /></span> : '—' },
        ]}
      />
      <p className={styles.muted}>{t('admin.createdOn', { date: day(lang, s.created_at) })}</p>
      <p className={styles.muted}>{t('admin.lastActive', { date: s.last_active_at ? day(lang, s.last_active_at) : t('admin.never') })}</p>
    </DetailPane>
  );
}
