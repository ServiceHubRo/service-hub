import { SearchX, Users } from 'lucide-react';
import { useDeferredValue, useMemo } from 'react';
import { Button } from '../../components/Button';
import { Chip, ChipRow } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { SkeletonList } from '../../components/Skeleton';
import { fetchClients, type AdminClientRow } from '../../data/admin';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { ExportButton } from './ExportButton';
import { CLIENT_FILTERS, filterClients, isClientFilter, NO_SHOW_FLAG } from '../../lib/admin';
import { formatPhone } from '../../lib/validators';
import { Pill, RowLink, Verified } from './parts';
import { adminClientPath } from './paths';
import { useLiveData } from './useLiveData';
import { useUrlParams } from './useUrlParams';
import { day } from './format';
import styles from './admin.module.css';

const LIVE = [{ table: 'profiles' }, { table: 'bookings' }];

/**
 * Clienți (FR §5.3, P20): account id, name, email, phone, verification, created, bookings and
 * no-shows (90 days); search and chips in the address (?q=&filtru=). Live.
 */
export function ClientsScreen() {
  const { t, lang } = useI18n();
  const { state, reload } = useLiveData(fetchClients, LIVE, 'admin-clients');
  const { params, setParam, text, setText } = useUrlParams();
  const filterParam = params.get('filtru');
  const filter = isClientFilter(filterParam) ? filterParam : 'all';
  const query = useDeferredValue(text);
  const all = state.status === 'ready' ? state.data : null;
  const shown = useMemo(() => (all ? filterClients(all, query, filter) : []), [all, query, filter]);

  return (
    <div className={styles.page}>
      <div>
        <h1>{t('nav.admin.clients')}</h1>
        {all && <p className={styles.sub}>{plural(lang, 'unit.clients', shown.length)}</p>}
      </div>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {all && all.length === 0 && <EmptyState icon={Users} title={t('admin.clients.empty')} />}
      {all && all.length > 0 && (
        <>
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
            <ChipRow label={t('admin.filter.label')}>
              {CLIENT_FILTERS.map((f) => (
                <Chip key={f} selected={filter === f} onClick={() => setParam({ filtru: f === 'all' ? null : f })}>
                  {t(`admin.clientFilter.${f}`)}
                </Chip>
              ))}
            </ChipRow>
            <div className={styles.toolbar}>
              <ExportButton<AdminClientRow>
                kind="clients"
                filters={{ q: query || undefined, filter: filter === 'all' ? undefined : filter }}
                narrow={(rows) => filterClients(rows, query, filter)}
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
                    setParam({ q: null, filtru: null });
                  }}
                >
                  {t('admin.clearFilters')}
                </Button>
              }
            />
          ) : (
            <ul className={styles.list}>
              {shown.map((c) => (
                <li key={c.id}>
                  <RowLink to={adminClientPath(c.id)}>
                    <span className={styles.rowTop}>
                      <span className={styles.rowTitle}>{c.name || t('admin.noName')}</span>
                      {c.suspended && <Pill tone="red">{t('admin.suspended')}</Pill>}
                      {c.no_shows >= NO_SHOW_FLAG && <Pill tone="amber">{t('admin.noShowFlag', { n: c.no_shows })}</Pill>}
                    </span>
                    <span className={styles.rowMeta}>
                      <span className={styles.id}>{c.display_id}</span>
                      {c.email && <span>{c.email}</span>}
                      {c.phone && <span className="mono">{formatPhone(c.phone)}</span>}
                    </span>
                    <span className={styles.checks}>
                      <Verified ok={c.email_verified} label={t('admin.email')} />
                    </span>
                    <span className={styles.rowMeta}>
                      <span>{t('admin.clients.bookings', { n: c.bookings })}</span>
                      <span>{t('admin.clients.noShows', { n: c.no_shows })}</span>
                      <span>{t('admin.createdOn', { date: day(lang, c.created_at) })}</span>
                      <span>{t('admin.lastActive', { date: c.last_active_at ? day(lang, c.last_active_at) : t('admin.never') })}</span>
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
