import { Inbox, MessageSquare, SearchX } from 'lucide-react';
import { useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { adminZoneBack } from '../../app/adminZones';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { DetailPane, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SelectField } from '../../components/SelectField';
import { fetchSupportCategories, listStaff, REQUEST_STATUSES, type StaffRequestItem } from '../../data/supportRequests';
import { useI18n } from '../../i18n/context';
import { DEFAULT_FILTERS, FILTER_PARAMS, filtersFrom, inboxArgs, waitingHours, type RequestFilters } from '../../lib/supportRequests';
import { useListDetail } from '../../lib/useListDetail';
import { useLoad } from '../../lib/useLoad';
import { ADMIN_REQUESTS_PATH, ADMIN_TEXT_REVIEWS_PATH, adminRequestPath } from '../admin/paths';
import adminStyles from '../admin/admin.module.css';
import { SUPPORT_REQUESTS_PATH, SUPPORT_TEXT_REVIEWS_PATH, supportRequestPath } from '../support/paths';
import { categoryName } from './format';
import { SupportDashboardPanel, WaitingPill } from './Dashboard';
import { RequestStatusPill } from './parts';
import { RequestDetail } from './RequestScreen';
import { useInbox } from './useInbox';
import styles from './requests.module.css';
import { StatusPill } from '../../components/StatusPill';
import { toneOf } from '../../lib/statusTone';

const loadMeta = () => Promise.all([fetchSupportCategories(), listStaff()]);

/**
 * Solicitări for the team (A3a): every request, the open ones first, filtered by who is responsible
 * (everyone, mine, nobody, escalated, one member), state, category and how long the author waits for
 * an answer. The filters stay in the address. The agent's list (/suport/solicitari) and the admin's
 * (/admin/suport/solicitari) are the same; only the admin acts on escalated requests.
 *
 * A3c1: above the list the counters (each opens the list with its filter) and the oldest request
 * without an answer; the database filters and pages the list (30 at a time, „Arată mai multe”);
 * everything stays live.
 */
export function InboxScreen({ mode }: { mode: 'support' | 'admin' }) {
  const { t, lang } = useI18n();
  const meta = useLoad(loadMeta);
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const filters = filtersFrom(params);
  const query = useMemo(() => inboxArgs(filters), [filters.owner, filters.status, filters.category, filters.age]); // eslint-disable-line react-hooks/exhaustive-deps
  const inbox = useInbox(query);
  const detailPath = mode === 'admin' ? adminRequestPath : supportRequestPath;
  const listPath = mode === 'admin' ? ADMIN_REQUESTS_PATH : SUPPORT_REQUESTS_PATH;
  const items = inbox.state.status === 'ready' ? inbox.state.data.items : [];
  // Page template A (C7): a request opens beside the list (in its place on a phone). Opening a request
  // is written in the audit log, so none opens by itself; one opened from a link or a counter stays
  // open whatever the filters show.
  const { wide, selectedId, open, select } = useListDetail(
    items.map((r) => r.id),
    'solicitare',
    { autoSelect: false, anyId: true },
  );

  function setFilter<K extends keyof RequestFilters>(key: K, value: RequestFilters[K]) {
    const next = new URLSearchParams(params);
    if (value === DEFAULT_FILTERS[key]) next.delete(FILTER_PARAMS[key]);
    else next.set(FILTER_PARAMS[key], value);
    setParams(next, { replace: true });
  }

  const zoneBack = mode === 'admin' ? adminZoneBack(ADMIN_REQUESTS_PATH) : null;
  const failed = meta.state.status === 'error' || inbox.state.status === 'error';
  const retry = () => {
    if (meta.state.status === 'error') meta.reload();
    if (inbox.state.status === 'error') inbox.reload();
  };
  const ready = meta.state.status === 'ready' && inbox.state.status === 'ready';
  const categories = meta.state.status === 'ready' ? meta.state.data[0] : [];
  const staff = meta.state.status === 'ready' ? meta.state.data[1] : [];
  const data = inbox.state.status === 'ready' ? inbox.state.data : null;
  const empty = ready && data !== null && !Object.values(data.dashboard.counts).some((n) => n > 0) && data.items.length === 0;

  const dashboard =
    ready && data ? (
      <SupportDashboardPanel
        dashboard={data.dashboard}
        filters={filters}
        listPath={listPath}
        detailPath={detailPath}
        reviewsPath={mode === 'admin' ? ADMIN_TEXT_REVIEWS_PATH : SUPPORT_TEXT_REVIEWS_PATH}
      />
    ) : null;

  const header = (
    <>
      {zoneBack && <BackLink to={zoneBack.to} label={t(zoneBack.label)} />}
      <PageHeader title={t('support.requests.title')} subtitle={t('support.inbox.desc')} />
      {ready && data && !empty && (
        <>
          {/* Beside the list the counters stand in the detail's place while no request is open. */}
          {!wide && dashboard}
          <div className={styles.filters}>
            <SelectField
              label={t('support.filter.owner')}
              value={filters.owner}
              onChange={(e) => setFilter('owner', e.target.value)}
              options={[
                { value: 'all', label: t('support.filter.owner.all') },
                { value: 'mine', label: t('support.filter.owner.mine') },
                { value: 'none', label: t('support.filter.owner.none') },
                { value: 'escalated', label: t('support.filter.owner.escalated') },
                ...staff.map((s) => ({ value: s.id, label: [s.display_id, s.name].filter(Boolean).join(' · ') })),
              ]}
            />
            <SelectField
              label={t('support.filter.status')}
              value={filters.status}
              onChange={(e) => setFilter('status', e.target.value as RequestFilters['status'])}
              options={[
                { value: 'open', label: t('support.filter.status.open') },
                { value: 'all', label: t('support.filter.status.all') },
                ...REQUEST_STATUSES.map((s) => ({ value: s, label: t(`support.staffStatus.${s}`) })),
              ]}
            />
            <SelectField
              label={t('support.filter.category')}
              value={filters.category}
              onChange={(e) => setFilter('category', e.target.value)}
              options={[
                { value: 'all', label: t('support.filter.category.all') },
                ...categories.map((c) => ({ value: c.key, label: lang === 'en' ? c.name_en : c.name_ro })),
              ]}
            />
            <SelectField
              label={t('support.filter.age')}
              value={filters.age}
              onChange={(e) => setFilter('age', e.target.value as RequestFilters['age'])}
              options={[
                { value: 'all', label: t('support.filter.age.all') },
                { value: '24', label: t('support.filter.age.24') },
                { value: '48', label: t('support.filter.age.48') },
              ]}
            />
          </div>
        </>
      )}
    </>
  );

  let list;
  if (failed) list = <LoadError message={t('support.inbox.loadError')} onRetry={retry} />;
  else if (!ready || !data) list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (empty) list = <EmptyState icon={Inbox} title={t('support.inbox.empty')} />;
  else if (data.key !== inbox.key) list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (data.items.length === 0) list = <EmptyState icon={SearchX} title={t('support.inbox.emptyFilter')} />;
  else {
    const now = new Date(data.dashboard.now);
    list = (
      <>
        <ListRows label={t('support.inbox.list')}>
          {data.items.map((r) => (
            <InboxRow
              key={r.id}
              r={r}
              now={now}
              categoryLabel={categoryName(categories, r.category, lang)}
              selected={r.id === selectedId}
              onSelect={() => select(r.id)}
            />
          ))}
        </ListRows>
        {data.next && (
          <div>
            <Button className={styles.more} disabled={inbox.more.busy} onClick={() => void inbox.loadMore(data)}>
              {t('support.inbox.more')}
            </Button>
          </div>
        )}
        {inbox.more.failed && (
          <p className={styles.fileError} role="alert">
            {t('support.inbox.moreError')}
          </p>
        )}
      </>
    );
  }

  const backParams = new URLSearchParams(params);
  backParams.delete('solicitare');
  const backQuery = backParams.toString();
  return (
    <div className={adminStyles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={backQuery ? `${pathname}?${backQuery}` : pathname}
        backLabel={t('support.requests.title')}
        header={header}
        list={list}
        detail={
          selectedId ? (
            <RequestDetail key={selectedId} mode={mode} requestId={selectedId} onChanged={() => void inbox.refetch()} />
          ) : wide && ready && !empty ? (
            <DetailPane id="overview" icon={<Inbox size={20} />} title={t('support.dash.label')}>
              {dashboard}
            </DetailPane>
          ) : null
        }
      />
    </div>
  );
}

function InboxRow({
  r,
  now,
  categoryLabel,
  selected,
  onSelect,
}: {
  r: StaffRequestItem;
  now: Date;
  categoryLabel: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const hours = waitingHours(r, now);
  const who = r.former_author
    ? t('admin.holds.req.formerAuthor', { id: r.former_author })
    : r.author.role === 'shop' && r.shop_name
      ? [r.author.display_id, r.shop_name].filter(Boolean).join(' · ')
      : [r.author.display_id, r.author.name].filter(Boolean).join(' · ');
  const assigned = r.assigned
    ? t('support.inbox.assigned', { who: [r.assigned.display_id, r.assigned.name].filter(Boolean).join(' · ') })
    : t('support.inbox.unassigned');
  return (
    <ListRow
      icon={<MessageSquare size={20} />}
      title={r.title}
      detail={[categoryLabel, who, assigned].filter(Boolean).join(' · ')}
      status={
        <>
          <RequestStatusPill status={r.status} staff />
          {r.escalated && <StatusPill tone={toneOf('red')}>{t('support.inbox.escalated')}</StatusPill>}
          {r.held && <StatusPill tone={toneOf('amber')}>{t('admin.holds.pill')}</StatusPill>}
          {hours !== null && <WaitingPill hours={hours} />}
        </>
      }
      attention={r.status === 'new'}
      selected={selected}
      onSelect={onSelect}
    />
  );
}
