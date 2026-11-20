import { MapPinned, SearchX } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ChoiceFilters } from '../../components/Filters';
import { InlinePanel } from '../../components/InlinePanel';
import { LoadError } from '../../components/LoadError';
import { SelectField } from '../../components/SelectField';
import { DetailFacts, DetailPane, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { fetchAdminAreas, setAreaMode, type AdminArea, type AdminAreas, type AreaMode } from '../../data/areas';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { fetchCategories, type SearchCategory } from '../../data/search';
import { adminZoneBack } from '../../app/adminZones';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { useListDetail } from '../../lib/useListDetail';
import { useLoad } from '../../lib/useLoad';
import { day } from './format';
import { Pill, SectionTitle } from './parts';
import { ADMIN_ZONES_PATH, adminShopPath } from './paths';
import { useUrlParams } from './useUrlParams';
import styles from './admin.module.css';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_ZONES_PATH);

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
  const { pathname } = useLocation();
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

  // Page template A (docs/MODEL_DE_FOLOSIRE.md P8): one row per zone, the chosen one beside the list
  // from 1024 px (in its place below).
  const { wide, selectedId, open, select } = useListDetail(
    shown.map((a) => a.code),
    'zona',
  );
  const chosen = shown.find((a) => a.code === selectedId) ?? null;

  const header = (
    <>
      <PageHeader back={{ to: ZONE_BACK.to, label: t(ZONE_BACK.label) }} title={t('admin.areas.title')} />
      <p className={styles.muted}>{t('admin.areas.intro')}</p>
      {all && (
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
        </>
      )}
      {notice && !open && (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      )}
    </>
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('admin.areas.loadError')} onRetry={reload} />;
  else if (state.status === 'ready')
    list = (
      <>
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
          <ListRows label={t('admin.areas.title')}>
            {shown.map((a) => (
              <ListRow
                key={a.code}
                icon={<MapPinned size={20} />}
                title={lang === 'ro' ? a.name_ro : a.name_en}
                detail={[t('admin.areas.shopsValue', { public: a.shops_public, total: a.shops_total }), a.waiting > 0 ? `${t('admin.areas.waiting')}: ${a.waiting}` : null]
                  .filter(Boolean)
                  .join(' · ')}
                status={<Pill tone={a.live ? 'green' : 'grey'}>{t(a.live ? 'admin.areas.live' : 'admin.areas.notLive')}</Pill>}
                attention={!a.live && a.waiting > 0}
                selected={wide && a.code === selectedId}
                onSelect={() => select(a.code)}
              />
            ))}
          </ListRows>
        )}
      </>
    );

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={pathname}
        backLabel={t('admin.areas.title')}
        header={header}
        list={list}
        detail={
          chosen &&
          state.status === 'ready' && (
            <ZoneDetail
              key={chosen.code}
              area={chosen}
              categories={state.data.categories}
              notice={open ? notice : null}
              onChanged={async (notified) => {
                setNotice(notified > 0 ? t('admin.areas.notifiedNow', { clients: plural(lang, 'unit.clients', notified) }) : null);
                await refresh();
              }}
            />
          )
        }
      />
    </div>
  );
}

function ZoneDetail({
  area: a,
  categories,
  notice,
  onChanged,
}: {
  area: AdminArea;
  categories: SearchCategory[];
  notice: string | null;
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
    <DetailPane
      id={a.code}
      icon={<MapPinned size={20} />}
      title={title}
      detail={t('admin.areas.shopsValue', { public: a.shops_public, total: a.shops_total })}
      status={<Pill tone={a.live ? 'green' : 'grey'}>{t(a.live ? 'admin.areas.live' : 'admin.areas.notLive')}</Pill>}
      message={notice ? { tone: 'success', text: notice } : undefined}
      panel={
        confirm !== null ? (
          <InlinePanel
            title={t('admin.areas.confirm.title', { area: title })}
            onClose={() => {
              setConfirm(null);
              setChosen(a.mode);
            }}
          >
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
        ) : undefined
      }
      actions={
        chosen !== a.mode ? (
          startsNow(chosen) ? (
            <Button variant="primary" onClick={() => setConfirm(chosen)}>
              {t('common.save')}
            </Button>
          ) : (
            <ActionButton onAction={(requestId) => apply(chosen, requestId)} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
              {t('common.save')}
            </ActionButton>
          )
        ) : undefined
      }
    >
      <DetailFacts
        items={[
          { label: t('admin.areas.waiting'), value: String(a.waiting) },
          { label: t('admin.areas.notified'), value: String(a.notified) },
          { label: t('admin.areas.launched'), value: a.launched_at ? day(lang, a.launched_at) : '—' },
          { label: t('admin.areas.categories'), value: a.categories.map((c) => `${categoryName(c.key)} (${c.count})`).join(', ') || '—' },
          { label: t('admin.areas.localities'), value: a.localities.map((l) => `${l.name} (${l.count})`).join(', ') || '—' },
        ]}
      />
      <SelectField
        label={t('admin.areas.mode')}
        value={chosen}
        disabled={confirm !== null}
        options={MODES.map((m) => ({ value: m, label: t(`admin.areas.mode.${m}`) }))}
        onChange={(e) => setChosen(e.target.value as AreaMode)}
      />
    </DetailPane>
  );
}

function Unplaced({ shops }: { shops: AdminAreas['unplaced'] }) {
  const { t } = useI18n();
  return (
    <section className={styles.section}>
      <SectionTitle>{t('admin.areas.unplaced.title')}</SectionTitle>
      <p className={styles.muted}>{t('admin.areas.unplaced.body')}</p>
      <ListRows label={t('admin.areas.unplaced.title')}>
        {shops.map((sh) => (
          <ListRow
            key={sh.id}
            icon={<MapPinned size={20} />}
            title={sh.name}
            detail={[sh.city, sh.county].filter(Boolean).join(' · ')}
            to={adminShopPath(sh.id)}
          />
        ))}
      </ListRows>
    </section>
  );
}
