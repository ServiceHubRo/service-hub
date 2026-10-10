import { MapPinned, SearchX } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ChoiceFilters } from '../../components/Filters';
import { InlinePanel } from '../../components/InlinePanel';
import { LoadError } from '../../components/LoadError';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { fetchAdminAreas, setAreaMode, type AdminArea, type AdminAreas, type AreaMode } from '../../data/areas';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { fetchCategories, type SearchCategory } from '../../data/search';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { useLoad } from '../../lib/useLoad';
import { day } from './format';
import { Facts, Pill } from './parts';
import { ADMIN_ACCOUNT_PATH, adminShopPath } from './paths';
import { useUrlParams } from './useUrlParams';
import styles from './admin.module.css';

const FILTERS = ['all', 'live', 'off', 'waiting'] as const;
type ZoneFilter = (typeof FILTERS)[number];
const isZoneFilter = (v: string | null): v is ZoneFilter => FILTERS.includes(v as ZoneFilter);
const MODES: AreaMode[] = ['auto', 'on', 'off'];

interface ZonesData extends AdminAreas {
  categories: SearchCategory[];
}

const load = async (): Promise<ZonesData> => {
  const [areas, categories] = await Promise.all([fetchAdminAreas(), fetchCategories()]);
  return { ...areas, categories };
};

function matches(a: AdminArea, f: ZoneFilter): boolean {
  if (f === 'live') return a.live;
  if (f === 'off') return !a.live;
  if (f === 'waiting') return a.waiting > 0;
  return true;
}

/**
 * Zone (Eduard, 8 Oct): the 41 counties and Bucharest — on or not yet, how many public shops, who
 * waits and what for. Each zone is automatic (it starts with its first public shop) or set by the
 * admin; turning one on tells the waiting clients at once (email + push, once), so it asks first.
 * Those waiting most come first.
 */
export function ZonesScreen() {
  const { t, lang } = useI18n();
  const { state, reload, setData } = useLoad(load);
  const { params, setParam } = useUrlParams();
  const filterParam = params.get('stare');
  const filter: ZoneFilter = isZoneFilter(filterParam) ? filterParam : 'all';
  const [notice, setNotice] = useState<string | null>(null);
  const all = state.status === 'ready' ? state.data.areas : null;
  const shown = useMemo(
    () => (all ? all.filter((a) => matches(a, filter)).sort((x, y) => y.waiting - x.waiting || Number(y.live) - Number(x.live)) : []),
    [all, filter],
  );

  const refresh = useCallback(async () => {
    const next = await load();
    setData(next);
  }, [setData]);

  return (
    <div className={styles.page}>
      <BackLink to={ADMIN_ACCOUNT_PATH} label={t('nav.account')} />
      <h1>{t('admin.areas.title')}</h1>
      <p className={styles.muted}>{t('admin.areas.intro')}</p>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.areas.loadError')} onRetry={reload} />}
      {state.status === 'ready' && all && (
        <>
          <p className={styles.sub}>
            {t('admin.areas.count.live', { n: all.filter((a) => a.live).length })} ·{' '}
            {t('admin.areas.count.off', { n: all.filter((a) => !a.live).length })} ·{' '}
            {t('admin.areas.count.waiting', { n: all.reduce((s, a) => s + a.waiting, 0) })}
          </p>
          <div className={styles.controls}>
            <ChoiceFilters
              groups={[
                {
                  key: 'stare',
                  title: t('admin.areas.title'),
                  options: FILTERS.map((f) => ({
                    value: f,
                    label: `${t(`admin.areas.filter.${f}`)} · ${all.filter((a) => matches(a, f)).length}`,
                  })),
                  value: filter,
                  defaultValue: 'all',
                  onChange: (v) => setParam({ stare: v === 'all' ? null : v }),
                },
              ]}
              onClearAll={() => setParam({ stare: null })}
            />
          </div>
          {notice && (
            <p className={styles.muted} role="status">
              {notice}
            </p>
          )}
          {state.data.unplaced.length > 0 && <Unplaced shops={state.data.unplaced} />}
          {shown.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={t('admin.areas.empty')}
              action={
                <Button variant="primary" onClick={() => setParam({ stare: null })}>
                  {t('admin.clearFilters')}
                </Button>
              }
            />
          ) : (
            <ul className={styles.list}>
              {shown.map((a) => (
                <li key={a.code}>
                  <ZoneCard
                    area={a}
                    categories={state.data.categories}
                    onChanged={async (notified) => {
                      setNotice(notified > 0 ? t('admin.areas.notifiedNow', { clients: plural(lang, 'unit.clients', notified) }) : null);
                      await refresh();
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function ZoneCard({
  area: a,
  categories,
  onChanged,
}: {
  area: AdminArea;
  categories: SearchCategory[];
  onChanged: (notified: number) => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const [confirm, setConfirm] = useState<AreaMode | null>(null);
  const [chosen, setChosen] = useState<AreaMode>(a.mode);
  const title = lang === 'ro' ? a.name_ro : a.name_en;
  const categoryName = (key: string) => {
    const c = categories.find((x) => x.key === key);
    return c ? (lang === 'ro' ? c.name_ro : c.name_en) : key;
  };
  // A change that makes the zone work now tells the waiting clients: ask first.
  const startsNow = (mode: AreaMode) => !a.live && a.waiting > 0 && (mode === 'on' || (mode === 'auto' && a.shops_public > 0));

  async function apply(mode: AreaMode, requestId: string) {
    const r = await setAreaMode(a.code, mode, requestId);
    setConfirm(null);
    await onChanged(r.notified);
  }

  return (
    <Card className={styles.stack}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{title}</h2>
        <span>
          <Pill tone={a.live ? 'green' : 'grey'}>{t(a.live ? 'admin.areas.live' : 'admin.areas.notLive')}</Pill>
        </span>
      </div>
      <Facts
        rows={[
          [t('admin.areas.shops'), t('admin.areas.shopsValue', { public: a.shops_public, total: a.shops_total })],
          [t('admin.areas.waiting'), String(a.waiting)],
          [t('admin.areas.notified'), String(a.notified)],
          [t('admin.areas.launched'), a.launched_at ? day(lang, a.launched_at) : null],
          [t('admin.areas.categories'), a.categories.map((c) => `${categoryName(c.key)} (${c.count})`).join(', ')],
          [t('admin.areas.localities'), a.localities.map((l) => `${l.name} (${l.count})`).join(', ')],
        ]}
      />
      <div className={styles.stack}>
        <SelectField
          label={t('admin.areas.mode')}
          value={chosen}
          disabled={confirm !== null}
          options={MODES.map((m) => ({ value: m, label: t(`admin.areas.mode.${m}`) }))}
          onChange={(e) => setChosen(e.target.value as AreaMode)}
        />
        {confirm === null ? (
          chosen !== a.mode &&
          (startsNow(chosen) ? (
            <Button variant="primary" onClick={() => setConfirm(chosen)}>
              {t('common.save')}
            </Button>
          ) : (
            <ActionButton
              onAction={(requestId) => apply(chosen, requestId)}
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              canRetry={canRetryRpc}
            >
              {t('common.save')}
            </ActionButton>
          ))
        ) : (
          <InlinePanel title={t('admin.areas.confirm.title', { area: title })}>
            <p className={styles.muted}>{t('admin.areas.confirm.body', { n: a.waiting })}</p>
            <div className={styles.panelButtons}>
              <ActionButton
                onAction={(requestId) => apply(confirm, requestId)}
                errorMessage={(e) => rpcErrorMessage(lang, e)}
                canRetry={canRetryRpc}
              >
                {t('admin.areas.confirm.yes')}
              </ActionButton>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirm(null);
                  setChosen(a.mode);
                }}
              >
                {t('admin.areas.confirm.no')}
              </Button>
            </div>
          </InlinePanel>
        )}
      </div>
    </Card>
  );
}

function Unplaced({ shops }: { shops: AdminAreas['unplaced'] }) {
  const { t } = useI18n();
  return (
    <Card className={styles.stack}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{t('admin.areas.unplaced.title')}</h2>
        <MapPinned size={18} aria-hidden="true" />
      </div>
      <p className={styles.muted}>{t('admin.areas.unplaced.body')}</p>
      <ul>
        {shops.map((s) => (
          <li key={s.id}>
            <Link className={styles.link} to={adminShopPath(s.id)}>
              {[s.name, s.city, s.county].filter(Boolean).join(' · ')}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
