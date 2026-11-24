import { SearchX, Users } from 'lucide-react';
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
import { fetchClients, type AdminClientRow } from '../../data/admin';
import { adminZoneBack } from '../../app/adminZones';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { ExportButton } from './ExportButton';
import { CLIENT_FILTERS, filterClients, isClientFilter, NO_SHOW_FLAG } from '../../lib/admin';
import { useListDetail } from '../../lib/useListDetail';
import { formatPhone } from '../../lib/validators';
import { Pill, Verified } from './parts';
import { ADMIN_CLIENTS_PATH, adminClientPath } from './paths';
import { useLiveData } from './useLiveData';
import { useUrlParams } from './useUrlParams';
import { day } from './format';
import styles from './admin.module.css';
import { PageHeader } from '../../components/PageHeader';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_CLIENTS_PATH);

const LIVE = [{ table: 'profiles' }, { table: 'bookings' }];

/**
 * Clienți (FR §5.3, P20): account id, name, email, phone, verification, created, bookings and
 * no-shows (90 days); search and chips in the address (?q=&filtru=). Live.
 */
export function ClientsScreen() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const { state, reload } = useLiveData(fetchClients, LIVE, 'admin-clients');
  const { params, setParam, text, setText } = useUrlParams();
  const filterParam = params.get('filtru');
  const filter = isClientFilter(filterParam) ? filterParam : 'all';
  const query = useDeferredValue(text);
  const all = state.status === 'ready' ? state.data : null;
  const shown = useMemo(() => (all ? filterClients(all, query, filter) : []), [all, query, filter]);

  // Page template A (docs/MODEL_DE_FOLOSIRE.md P8): one row per client, the chosen one beside the list
  // from 1024 px (in its place below); the whole file is „Deschide fișa”.
  const { wide, selectedId, open, select } = useListDetail(
    shown.map((c) => c.id),
    'cont',
  );
  const chosen = shown.find((c) => c.id === selectedId) ?? null;

  const header = (
    <>
      <PageHeader back={{ to: ZONE_BACK.to, label: t(ZONE_BACK.label) }} title={t('nav.admin.clients')} subtitle={all ? plural(lang, 'unit.clients', shown.length) : undefined} />
      {all && all.length > 0 && (
          <div className={styles.controls}>
            <SearchField
              id="admin-clients-q"
              label={t('admin.clients.search')}
              placeholder={t('admin.clients.search')}
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
                  key: 'filtru',
                  title: t('admin.filter.label'),
                  options: CLIENT_FILTERS.map((f) => ({ value: f, label: t(`admin.clientFilter.${f}`) })),
                  value: filter,
                  defaultValue: 'all',
                  onChange: (v) => setParam({ filtru: v === 'all' ? null : v }),
                },
              ]}
              end={
                <div className={styles.toolbar}>
                  <ExportButton<AdminClientRow>
                    kind="clients"
                    filters={{ q: query || undefined, filter: filter === 'all' ? undefined : filter }}
                    ids={shown.map((r) => r.id)}
                    narrow={(rows) => filterClients(rows, query, filter)}
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
  else if (all && all.length === 0) list = <EmptyState icon={Users} title={t('admin.clients.empty')} />;
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
                    setParam({ q: null, filtru: null });
                  }}
                >
                  {t('admin.clearFilters')}
                </Button>
              }
            />
    );
  else
    list = (
      <ListRows label={t('nav.admin.clients')}>
        {shown.map((c) => (
          <ListRow
            key={c.id}
            icon={<Users size={20} />}
            title={c.name || t('admin.noName')}
            detail={[c.display_id, c.email, c.phone ? formatPhone(c.phone) : null].filter(Boolean).join(' · ')}
            status={<ClientPill c={c} />}
            selected={wide && c.id === selectedId}
            onSelect={() => select(c.id)}
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
        backLabel={t('nav.admin.clients')}
        header={header}
        list={list}
        detail={chosen && <ClientDetail key={chosen.id} c={chosen} />}
      />
    </div>
  );
}

/** What stands out about a client: suspended, or past the no-show limit. */
function ClientPill({ c }: { c: AdminClientRow }) {
  const { t } = useI18n();
  if (c.suspended) return <Pill tone="red">{t('admin.suspended')}</Pill>;
  if (c.no_shows >= NO_SHOW_FLAG) return <Pill tone="amber">{t('admin.noShowFlag', { n: c.no_shows })}</Pill>;
  return null;
}

/** One client in the list's detail; the whole file (cars, bookings, reviews, the log) is „Deschide fișa”. */
function ClientDetail({ c }: { c: AdminClientRow }) {
  const { t, lang } = useI18n();
  return (
    <DetailPane
      id={c.id}
      icon={<Users size={20} />}
      title={c.name || t('admin.noName')}
      detail={c.display_id}
      status={<ClientPill c={c} />}
      actions={
        <Link className={buttonClass('secondary')} to={adminClientPath(c.id)}>
          {t('admin.clients.open')}
        </Link>
      }
    >
      <DetailFacts
        items={[
          { label: t('admin.email'), value: c.email ? <span>{c.email} <Verified ok={c.email_verified} label={t('admin.email')} /></span> : '—' },
          { label: t('admin.phone'), value: c.phone ? <span className="mono">{formatPhone(c.phone)}</span> : '—' },
        ]}
      />
      <p className={styles.muted}>{t('admin.clients.bookings', { n: c.bookings })}</p>
      <p className={styles.muted}>{t('admin.clients.noShows', { n: c.no_shows })}</p>
      <p className={styles.muted}>{t('admin.createdOn', { date: day(lang, c.created_at) })}</p>
      <p className={styles.muted}>{t('admin.lastActive', { date: c.last_active_at ? day(lang, c.last_active_at) : t('admin.never') })}</p>
    </DetailPane>
  );
}
