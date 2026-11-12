import { ClipboardList, Plus, SearchX, Users } from 'lucide-react';
import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLiveSearchParams } from '../../app/useLiveSearchParams';
import { buttonClass } from '../../components/buttonClass';
import { Chip, ChipRow } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SearchField } from '../../components/SearchField';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { fetchProcedures, PROCEDURE_CATEGORIES, type Procedure, type ProcedureCategory, type ProcedureKind, type ProcedureLibrary } from '../../data/procedures';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import { filterProcedures, NO_FILTERS, recentProcedures, searchProcedures, toConfirm, type LibraryFilters } from '../../lib/procedures';
import { adminZoneBack } from '../../app/adminZones';
import { ProcedureRow } from './parts';
import { newProcedurePath, procedurePath, proceduresHome, responsiblesPath, type ProcedureMode } from './paths';
import styles from './procedures.module.css';

const ZONE_BACK = adminZoneBack(proceduresHome('admin'));

function Rows({ items, mode, snippets }: { items: Procedure[]; mode: ProcedureMode; snippets?: Map<string, string | null> }) {
  return (
    <ul className={styles.rows}>
      {items.map((p) => (
        <ProcedureRow
          key={p.id}
          p={p}
          to={procedurePath(mode, p.id)}
          extra={snippets?.get(p.id) ? <span className={styles.rowSnippet}>{snippets.get(p.id)}</span> : undefined}
        />
      ))}
    </ul>
  );
}

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={styles.block}>
      <h2 id={id} className={styles.blockTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The procedures library (A5), for an agent (`/suport/proceduri`) and the admin (Suport → Proceduri
 * interne): search over the texts as one types, filters by category, type and responsible, the critical
 * procedures still to confirm first, then what is in work, the latest published, the usual and the
 * exceptional ones. An agent sees only what is published for agents and the drafts it may edit; the
 * database decides.
 */
export function ProceduresScreen({ mode }: { mode: ProcedureMode }) {
  const { t, lang, plural } = useI18n();
  const { state, reload } = useLoad(fetchProcedures);
  const [params, setParams] = useLiveSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const query = useDeferredValue(text);
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS);
  const set = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  const setQuery = (value: string) => {
    setText(value);
    const next = new URLSearchParams(params);
    if (value.trim()) next.set('q', value);
    else next.delete('q');
    setParams(next, { replace: true, preventScrollReset: true });
  };

  const data: ProcedureLibrary | null = state.status === 'ready' ? state.data : null;
  const shown = useMemo(() => (data ? filterProcedures(data.procedures, filters) : []), [data, filters]);
  const searching = query.trim() !== '';
  const hits = useMemo(() => (searching ? searchProcedures(shown, lang, query) : []), [searching, shown, lang, query]);
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  // The responsibles that exist, for the filter.
  const responsibles = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of data?.categories ?? []) {
      const u = c.responsible?.user;
      if (u && !c.responsible?.needs_reassignment) seen.set(u.id, [u.display_id, u.name].filter(Boolean).join(' · '));
    }
    return [...seen.entries()];
  }, [data]);

  return (
    <div className={styles.page}>
      <PageHeader
        back={mode === 'admin' ? { to: ZONE_BACK.to, label: t(ZONE_BACK.label) } : undefined}
        title={t('proc.title')}
        subtitle={t('proc.sub')}
        actions={
          <div className={styles.headerActions}>
            <Link to={newProcedurePath(mode)} className={buttonClass('primary')}>
              <Plus size={18} aria-hidden="true" />
              {mode === 'admin' ? t('proc.new') : t('proc.propose')}
            </Link>
            <Link to={responsiblesPath(mode)} className={buttonClass('secondary')}>
              <Users size={18} aria-hidden="true" />
              {t('proc.responsibles')}
            </Link>
          </div>
        }
      />

      <div className={styles.toolbar}>
        <SearchField
          id="proc-q"
          label={t('proc.search.label')}
          placeholder={t('proc.search.placeholder')}
          value={text}
          onChange={setQuery}
          onClear={() => setQuery('')}
          clearLabel={t('proc.search.clear')}
        />
        <SelectField
          label={t('proc.filter.category')}
          value={filters.category}
          onChange={(e) => set('category', e.target.value as ProcedureCategory | '')}
          options={[{ value: '', label: t('proc.filter.allCategories') }, ...PROCEDURE_CATEGORIES.map((c) => ({ value: c, label: t(`proc.category.${c}`) }))]}
        />
        <SelectField
          label={t('proc.filter.kind')}
          value={filters.kind}
          onChange={(e) => set('kind', e.target.value as ProcedureKind | '')}
          options={[
            { value: '', label: t('proc.filter.allKinds') },
            { value: 'usual', label: t('proc.kind.usual') },
            { value: 'exceptional', label: t('proc.kind.exceptional') },
          ]}
        />
        <SelectField
          label={t('proc.filter.responsible')}
          value={filters.responsible}
          onChange={(e) => set('responsible', e.target.value)}
          options={[
            { value: '', label: t('proc.filter.anyone') },
            ...responsibles.map(([id, label]) => ({ value: id, label })),
            { value: 'none', label: t('proc.filter.noOne') },
          ]}
        />
      </div>
      <ChipRow label={t('proc.filter.label')}>
        <Chip selected={filters.critical} onClick={() => set('critical', !filters.critical)}>
          {t('proc.filter.critical')}
        </Chip>
        <Chip selected={filters.inWork} onClick={() => set('inWork', !filters.inWork)}>
          {t('proc.filter.inWork')}
        </Chip>
      </ChipRow>

      {state.status === 'loading' && <SkeletonList count={3} />}
      {state.status === 'error' && <LoadError message={t('proc.loadError')} onRetry={reload} />}
      {data && data.procedures.length === 0 && <EmptyState icon={ClipboardList} title={t('proc.empty')} />}
      {data && data.procedures.length > 0 && shown.length === 0 && <EmptyState icon={SearchX} title={t('proc.emptyFiltered')} />}

      {data && shown.length > 0 && searching && (
        hits.length === 0 ? (
          <EmptyState icon={SearchX} title={t('proc.search.empty', { q: query.trim() })} />
        ) : (
          <Block id="proc-results" title={plural('unit.procedures', hits.length)}>
            <Rows items={hits.map((h) => h.article.procedure)} mode={mode} snippets={new Map(hits.map((h) => [h.article.id, h.snippet]))} />
          </Block>
        )
      )}

      {data && shown.length > 0 && !searching && filtered && (
        <Block id="proc-filtered" title={plural('unit.procedures', shown.length)}>
          <Rows items={shown} mode={mode} />
        </Block>
      )}

      {data && shown.length > 0 && !searching && !filtered && <Overview procedures={shown} mode={mode} />}
    </div>
  );
}

function Overview({ procedures, mode }: { procedures: Procedure[]; mode: ProcedureMode }) {
  const { t } = useI18n();
  const live = procedures.filter((p) => p.status === 'published' && p.published);
  const confirm = toConfirm(live);
  const inWork = procedures.filter((p) => p.open);
  const recent = recentProcedures(live);
  const usual = live.filter((p) => p.kind === 'usual');
  const exceptional = live.filter((p) => p.kind === 'exceptional');
  const archived = procedures.filter((p) => p.status === 'archived');
  return (
    <>
      {confirm.length > 0 && (
        <Block id="proc-confirm" title={t('proc.section.toConfirm')}>
          <Rows items={confirm} mode={mode} />
        </Block>
      )}
      {inWork.length > 0 && (
        <Block id="proc-work" title={t('proc.section.inWork')}>
          <Rows items={inWork} mode={mode} />
        </Block>
      )}
      {recent.length > 0 && (
        <Block id="proc-recent" title={t('proc.section.recent')}>
          <Rows items={recent} mode={mode} />
        </Block>
      )}
      {exceptional.length > 0 && (
        <Block id="proc-exceptional" title={t('proc.section.exceptional')}>
          <Rows items={exceptional} mode={mode} />
        </Block>
      )}
      {usual.length > 0 && (
        <Block id="proc-usual" title={t('proc.section.usual')}>
          <Rows items={usual} mode={mode} />
        </Block>
      )}
      {archived.length > 0 && (
        <Block id="proc-archived" title={t('proc.section.archived')}>
          <Rows items={archived} mode={mode} />
        </Block>
      )}
      {live.length === 0 && inWork.length === 0 && archived.length === 0 && <EmptyState icon={ClipboardList} title={t('proc.empty')} />}
    </>
  );
}
