import { Activity } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { fetchOverview, type ActivityItem, type BookingWindow } from '../../data/admin';
import { fetchSupportDashboard } from '../../data/supportRequests';
import { useI18n } from '../../i18n/context';
import { formatMoney } from '../../i18n/format';
import { BOOKING_STATUSES } from '../../lib/status';
import { Pill, RowLink, SectionTitle } from './parts';
import { filterSearch } from '../../lib/supportRequests';
import { TEAM_SIGNALS } from '../requests/useInbox';
import {
  ADMIN_BOOKINGS_PATH,
  ADMIN_CLIENTS_PATH,
  ADMIN_HOLDS_PATH,
  ADMIN_MODERATION_PATH,
  ADMIN_REQUESTS_PATH,
  ADMIN_SHOPS_PATH,
  adminBookingPath,
  adminClientPath,
  adminShopPath,
} from './paths';
import { useLiveData } from './useLiveData';
import { dateTime } from './format';
import styles from './admin.module.css';

const LIVE = [{ table: 'bookings' }, { table: 'reviews' }, { table: 'shops' }, { table: 'subscriptions' }, { table: 'profiles' }] as const;

function Stat({ n, label, to, alert, children }: { n: ReactNode; label: string; to?: string; alert?: boolean; children?: ReactNode }) {
  const inner = (
    <>
      <span className={styles.statNumber}>{n}</span>
      <span className={styles.statLabel}>{label}</span>
      {children}
    </>
  );
  return (
    <li>
      {to ? (
        <Link to={to} className={`${styles.stat} ${alert ? styles.statAlert : ''}`}>
          {inner}
        </Link>
      ) : (
        <div className={styles.stat}>{inner}</div>
      )}
    </li>
  );
}

function Breakdown({ window }: { window: BookingWindow }) {
  const { t } = useI18n();
  const parts = BOOKING_STATUSES.filter((s) => (window.by_status[s] ?? 0) > 0);
  if (parts.length === 0) return null;
  return (
    <span className={styles.breakdown}>
      {parts.map((s) => (
        <span key={s}>
          {t(`status.${s}`)}: {window.by_status[s]}
        </span>
      ))}
    </span>
  );
}

function activityLink(a: ActivityItem): string {
  switch (a.kind) {
    case 'shop_created':
    case 'payment_failed':
      return adminShopPath(a.id);
    case 'client_created':
      return adminClientPath(a.id);
    case 'booking_created':
      return adminBookingPath(a.id);
    case 'review_reported':
      return ADMIN_MODERATION_PATH;
  }
}

function ActivityText({ a }: { a: ActivityItem }) {
  const { t, lang } = useI18n();
  switch (a.kind) {
    case 'shop_created':
      return <>{t('admin.activity.shop_created', { name: a.name, city: a.city })}</>;
    case 'client_created':
      return <>{t('admin.activity.client_created', { name: a.name || a.display_id })}</>;
    case 'booking_created':
      return (
        <>{t('admin.activity.booking_created', { ref: a.ref, name: a.name, service: (lang === 'ro' ? a.service_ro : a.service_en) ?? '' })}</>
      );
    case 'review_reported':
      return <>{t('admin.activity.review_reported', { name: a.name, reason: t(`reviews.reason.${a.reason}`) })}</>;
    case 'payment_failed':
      return <>{t('admin.activity.payment_failed', { name: a.name })}</>;
  }
}

/**
 * Prezentare (FR §5.1, P19): the platform in numbers — shops by state, clients, new bookings today /
 * 7 / 30 days by status, reported reviews waiting, subscriptions and monthly revenue — and the
 * last 50 things that happened. Live: every change reads it again quietly.
 */
export function OverviewScreen() {
  const { t, lang } = useI18n();
  const { state, reload } = useLiveData(fetchOverview, LIVE, 'admin-overview');
  // A3c1: the support requests at a glance, live; on its own, so a failure here hides only this part.
  const support = useLiveData(fetchSupportDashboard, TEAM_SIGNALS, 'admin-overview-support');

  return (
    <div className={styles.page}>
      <h1>{t('nav.admin.overview')}</h1>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (() => {
          const o = state.data;
          return (
            <>
              <SectionTitle>{t('admin.overview.shops')}</SectionTitle>
              <ul className={styles.stats}>
                <Stat n={o.shops.active} label={t('admin.shopFilter.active')} to={`${ADMIN_SHOPS_PATH}?stare=active`} />
                <Stat n={o.shops.trial} label={t('admin.shopFilter.trial')} to={`${ADMIN_SHOPS_PATH}?stare=trial`} />
                <Stat n={o.shops.inactive} label={t('admin.shopFilter.inactive')} to={`${ADMIN_SHOPS_PATH}?stare=inactive`} />
                <Stat n={o.shops.suspended} label={t('admin.shopFilter.suspended')} to={`${ADMIN_SHOPS_PATH}?stare=suspended`} />
              </ul>

              <SectionTitle>{t('admin.overview.people')}</SectionTitle>
              <ul className={styles.stats}>
                <Stat n={o.clients} label={t('admin.overview.clients')} to={ADMIN_CLIENTS_PATH} />
                <Stat
                  n={o.reports_pending}
                  label={t('admin.overview.reports')}
                  to={ADMIN_MODERATION_PATH}
                  alert={o.reports_pending > 0}
                />
                <Stat n={o.shops.total} label={t('admin.overview.shopsTotal')} to={ADMIN_SHOPS_PATH} />
              </ul>

              {support.state.status === 'ready' &&
                (() => {
                  const c = support.state.data.counts;
                  const to = (key: Parameters<typeof filterSearch>[0], value: string) => `${ADMIN_REQUESTS_PATH}${filterSearch(key, value)}`;
                  return (
                    <>
                      <SectionTitle>{t('admin.overview.support')}</SectionTitle>
                      <ul className={styles.stats}>
                        <Stat n={c.new} label={t('support.dash.new')} to={to('status', 'new')} />
                        <Stat n={c.unassigned} label={t('support.dash.unassigned')} to={to('owner', 'none')} alert={c.unassigned > 0} />
                        <Stat n={c.escalated} label={t('support.dash.escalated')} to={to('owner', 'escalated')} alert={c.escalated > 0} />
                        <Stat n={c.over_48} label={t('support.dash.over48')} to={to('age', '48')} alert={c.over_48 > 0} />
                        {c.holds_due !== undefined && c.holds_due > 0 && (
                          <Stat n={c.holds_due} label={t('admin.holds.dash.due')} to={ADMIN_HOLDS_PATH} alert />
                        )}
                      </ul>
                    </>
                  );
                })()}
              {support.state.status === 'error' && <LoadError message={t('support.dash.loadError')} onRetry={support.reload} />}

              <SectionTitle>{t('admin.overview.bookings')}</SectionTitle>
              <ul className={styles.stats}>
                <Stat n={o.bookings.today.total} label={t('admin.overview.today')} to={ADMIN_BOOKINGS_PATH}>
                  <Breakdown window={o.bookings.today} />
                </Stat>
                <Stat n={o.bookings.week.total} label={t('admin.overview.week')} to={ADMIN_BOOKINGS_PATH}>
                  <Breakdown window={o.bookings.week} />
                </Stat>
                <Stat n={o.bookings.month.total} label={t('admin.overview.month')} to={ADMIN_BOOKINGS_PATH}>
                  <Breakdown window={o.bookings.month} />
                </Stat>
              </ul>

              <SectionTitle>{t('admin.overview.subscriptions')}</SectionTitle>
              <ul className={styles.stats}>
                <Stat n={o.subscriptions.active} label={t('admin.overview.paying')} />
                <Stat n={o.subscriptions.trial_ending} label={t('admin.overview.trialEnding')} alert={o.subscriptions.trial_ending > 0} />
                <Stat n={o.subscriptions.past_due} label={t('admin.overview.pastDue')} alert={o.subscriptions.past_due > 0} />
                <Stat n={formatMoney(lang, o.subscriptions.mrr)} label={t('admin.overview.mrr')} />
              </ul>

              <SectionTitle>{t('admin.overview.activity')}</SectionTitle>
              {o.activity.length === 0 ? (
                <EmptyState icon={Activity} title={t('admin.overview.noActivity')} />
              ) : (
                <ul className={styles.list}>
                  {o.activity.map((a) => (
                    <li key={`${a.kind}-${a.id}-${a.at}`}>
                      <RowLink to={activityLink(a)}>
                        <span className={styles.rowTop}>
                          <Pill tone={a.kind === 'review_reported' || a.kind === 'payment_failed' ? 'amber' : 'blue'}>
                            {t(`admin.activityKind.${a.kind}`)}
                          </Pill>
                          <span className={styles.muted}>{dateTime(lang, a.at)}</span>
                        </span>
                        <span>
                          <ActivityText a={a} />
                        </span>
                      </RowLink>
                    </li>
                  ))}
                </ul>
              )}
            </>
          );
        })()}
    </div>
  );
}
