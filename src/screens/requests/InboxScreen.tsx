import { Inbox, SearchX } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminZoneBack } from '../../app/adminZones';
import { BackLink } from '../../components/BackLink';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { fetchSupportCategories, listRequests, listStaff, REQUEST_STATUSES } from '../../data/supportRequests';
import { useI18n } from '../../i18n/context';
import { DEFAULT_FILTERS, FILTER_PARAMS, filterRequests, filtersFrom, waitingHours, type RequestFilters } from '../../lib/supportRequests';
import { useLoad } from '../../lib/useLoad';
import { ADMIN_REQUESTS_PATH, adminRequestPath } from '../admin/paths';
import adminStyles from '../admin/admin.module.css';
import { supportRequestPath } from '../support/paths';
import { categoryName, whenText } from './format';
import { RequestStatusPill } from './parts';
import styles from './requests.module.css';

const load = () => Promise.all([listRequests(), fetchSupportCategories(), listStaff()]);

/**
 * Solicitări for the team (A3a): every request, the open ones first, filtered by who is responsible
 * (everyone, mine, nobody, escalated, one member), state, category and how long the author waits for
 * an answer. The filters stay in the address. The agent's list (/suport/solicitari) and the admin's
 * (/admin/suport/solicitari) are the same; only the admin acts on escalated requests.
 */
export function InboxScreen({ mode }: { mode: 'support' | 'admin' }) {
  const { t, lang } = useI18n();
  const { state, reload } = useLoad(load);
  const [params, setParams] = useSearchParams();
  const filters = filtersFrom(params);
  const detailPath = mode === 'admin' ? adminRequestPath : supportRequestPath;
  // The moment the list was opened: how long each author waits is measured from it.
  const [now] = useState(() => new Date());

  function setFilter<K extends keyof RequestFilters>(key: K, value: RequestFilters[K]) {
    const next = new URLSearchParams(params);
    if (value === DEFAULT_FILTERS[key]) next.delete(FILTER_PARAMS[key]);
    else next.set(FILTER_PARAMS[key], value);
    setParams(next, { replace: true });
  }

  const shown = state.status === 'ready' ? filterRequests(state.data[0].items, filters, state.data[0].me, now) : [];
  const zoneBack = mode === 'admin' ? adminZoneBack(ADMIN_REQUESTS_PATH) : null;

  return (
    <div className={adminStyles.page}>
      {zoneBack && <BackLink to={zoneBack.to} label={t(zoneBack.label)} />}
      <PageHeader title={t('support.requests.title')} subtitle={t('support.inbox.desc')} />
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('support.inbox.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (() => {
          const [{ items }, categories, staff] = state.data;
          if (items.length === 0) return <EmptyState icon={Inbox} title={t('support.inbox.empty')} />;
          return (
            <>
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
              {shown.length === 0 ? (
                <EmptyState icon={SearchX} title={t('support.inbox.emptyFilter')} />
              ) : (
                <ul className={styles.list}>
                  {shown.map((r) => {
                    const hours = waitingHours(r, now);
                    const who =
                      r.author.role === 'shop' && r.shop_name
                        ? [r.author.display_id, r.shop_name].filter(Boolean).join(' · ')
                        : [r.author.display_id, r.author.name].filter(Boolean).join(' · ');
                    return (
                      <li key={r.id}>
                        <Link to={detailPath(r.id)} className={styles.cardLink}>
                          <Card className={styles.row}>
                            <span className={styles.rowTop}>
                              <span className={styles.rowTitle}>{r.title}</span>
                              <RequestStatusPill status={r.status} staff />
                              {r.escalated && <span className={`${styles.pill} ${styles.red}`}>{t('support.inbox.escalated')}</span>}
                            </span>
                            <span className={styles.meta}>
                              <span>{categoryName(categories, r.category, lang)}</span>
                              {who && <span>{who}</span>}
                              <span>
                                {r.assigned
                                  ? t('support.inbox.assigned', { who: [r.assigned.display_id, r.assigned.name].filter(Boolean).join(' · ') })
                                  : t('support.inbox.unassigned')}
                              </span>
                            </span>
                            {r.waiting_since && hours !== null && (
                              <span className={styles.meta}>
                                <span
                                  className={hours >= 48 ? `${styles.pill} ${styles.red}` : hours >= 24 ? `${styles.pill} ${styles.amber}` : undefined}
                                >
                                  {t('support.inbox.waiting', { date: whenText(lang, r.waiting_since) })}
                                </span>
                              </span>
                            )}
                          </Card>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          );
        })()}
    </div>
  );
}
