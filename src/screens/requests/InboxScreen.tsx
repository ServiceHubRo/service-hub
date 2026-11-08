import { Inbox, SearchX } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminZoneBack } from '../../app/adminZones';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { fetchSupportCategories, listStaff, REQUEST_STATUSES, type StaffRequestItem } from '../../data/supportRequests';
import { useI18n } from '../../i18n/context';
import { DEFAULT_FILTERS, FILTER_PARAMS, filtersFrom, inboxArgs, waitingHours, type RequestFilters } from '../../lib/supportRequests';
import { useLoad } from '../../lib/useLoad';
import { ADMIN_REQUESTS_PATH, adminRequestPath } from '../admin/paths';
import adminStyles from '../admin/admin.module.css';
import { SUPPORT_REQUESTS_PATH, supportRequestPath } from '../support/paths';
import { categoryName } from './format';
import { SupportDashboardPanel, WaitingPill } from './Dashboard';
import { RequestStatusPill } from './parts';
import { useInbox } from './useInbox';
import styles from './requests.module.css';

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
  const filters = filtersFrom(params);
  const query = useMemo(() => inboxArgs(filters), [filters.owner, filters.status, filters.category, filters.age]); // eslint-disable-line react-hooks/exhaustive-deps
  const inbox = useInbox(query);
  const detailPath = mode === 'admin' ? adminRequestPath : supportRequestPath;
  const listPath = mode === 'admin' ? ADMIN_REQUESTS_PATH : SUPPORT_REQUESTS_PATH;

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

  return (
    <div className={adminStyles.page}>
      {zoneBack && <BackLink to={zoneBack.to} label={t(zoneBack.label)} />}
      <PageHeader title={t('support.requests.title')} subtitle={t('support.inbox.desc')} />
      {failed && <LoadError message={t('support.inbox.loadError')} onRetry={retry} />}
      {!failed && (meta.state.status !== 'ready' || inbox.state.status !== 'ready') && <SkeletonList />}
      {meta.state.status === 'ready' &&
        inbox.state.status === 'ready' &&
        (() => {
          const [categories, staff] = meta.state.data;
          const data = inbox.state.data;
          const now = new Date(data.dashboard.now);
          const total = Object.values(data.dashboard.counts).some((n) => n > 0);
          if (!total && data.items.length === 0) return <EmptyState icon={Inbox} title={t('support.inbox.empty')} />;
          const current = data.key === inbox.key;
          return (
            <>
              <SupportDashboardPanel dashboard={data.dashboard} filters={filters} listPath={listPath} detailPath={detailPath} />
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
              {!current ? (
                <SkeletonList />
              ) : data.items.length === 0 ? (
                <EmptyState icon={SearchX} title={t('support.inbox.emptyFilter')} />
              ) : (
                <>
                  <ul className={styles.list}>
                    {data.items.map((r) => (
                      <li key={r.id}>
                        <InboxRow r={r} now={now} to={detailPath(r.id)} categoryLabel={categoryName(categories, r.category, lang)} />
                      </li>
                    ))}
                  </ul>
                  {data.next && (
                    <Button className={styles.more} disabled={inbox.more.busy} onClick={() => void inbox.loadMore(data)}>
                      {t('support.inbox.more')}
                    </Button>
                  )}
                  {inbox.more.failed && (
                    <p className={styles.fileError} role="alert">
                      {t('support.inbox.moreError')}
                    </p>
                  )}
                </>
              )}
            </>
          );
        })()}
    </div>
  );
}

function InboxRow({ r, now, to, categoryLabel }: { r: StaffRequestItem; now: Date; to: string; categoryLabel: string }) {
  const { t } = useI18n();
  const hours = waitingHours(r, now);
  const who =
    r.author.role === 'shop' && r.shop_name
      ? [r.author.display_id, r.shop_name].filter(Boolean).join(' · ')
      : [r.author.display_id, r.author.name].filter(Boolean).join(' · ');
  return (
    <Link to={to} className={styles.cardLink}>
      <Card className={styles.row}>
        <span className={styles.rowTop}>
          <span className={styles.rowTitle}>{r.title}</span>
          <RequestStatusPill status={r.status} staff />
          {r.escalated && <span className={`${styles.pill} ${styles.red}`}>{t('support.inbox.escalated')}</span>}
        </span>
        <span className={styles.meta}>
          <span>{categoryLabel}</span>
          {who && <span>{who}</span>}
          <span>
            {r.assigned
              ? t('support.inbox.assigned', { who: [r.assigned.display_id, r.assigned.name].filter(Boolean).join(' · ') })
              : t('support.inbox.unassigned')}
          </span>
        </span>
        {hours !== null && (
          <span className={styles.meta}>
            <WaitingPill hours={hours} />
          </span>
        )}
      </Card>
    </Link>
  );
}
