import { Link } from 'react-router-dom';
import type { MessageKey } from '../../i18n/ro';
import type { SupportCounts, SupportDashboard } from '../../data/supportRequests';
import { useI18n } from '../../i18n/context';
import { formatDecimal } from '../../i18n/format';
import { DEFAULT_FILTERS, filterSearch, waitingLevel, waitingSpan, type RequestFilters } from '../../lib/supportRequests';
import adminStyles from '../admin/admin.module.css';
import styles from './requests.module.css';

/** A counter: its number, its words and the one filter it opens the list with. */
interface Tile {
  count: Exclude<keyof SupportCounts, 'holds_due'>;
  label: MessageKey;
  filter: keyof RequestFilters;
  value: string;
  /** Shown as a warning when above zero. */
  warn?: 'late' | 'urgent';
}

const TILES: Tile[] = [
  { count: 'new', label: 'support.dash.new', filter: 'status', value: 'new' },
  { count: 'in_progress', label: 'support.dash.in_progress', filter: 'status', value: 'in_progress' },
  { count: 'waiting_user', label: 'support.dash.waiting_user', filter: 'status', value: 'waiting_user' },
  { count: 'escalated', label: 'support.dash.escalated', filter: 'owner', value: 'escalated' },
  { count: 'unassigned', label: 'support.dash.unassigned', filter: 'owner', value: 'none' },
  { count: 'mine', label: 'support.dash.mine', filter: 'owner', value: 'mine' },
  { count: 'over_24', label: 'support.dash.over24', filter: 'age', value: '24', warn: 'late' },
  { count: 'over_48', label: 'support.dash.over48', filter: 'age', value: '48', warn: 'urgent' },
  { count: 'resolved', label: 'support.dash.resolved', filter: 'status', value: 'resolved' },
  { count: 'closed', label: 'support.dash.closed', filter: 'status', value: 'closed' },
];

/** The filters equal this counter's (its filter set, every other one at its default). */
function isCurrent(tile: Tile, f: RequestFilters): boolean {
  return (Object.keys(DEFAULT_FILTERS) as (keyof RequestFilters)[]).every((k) =>
    k === tile.filter ? f[k] === tile.value : f[k] === DEFAULT_FILTERS[k],
  );
}

/** How long an author has waited, in words; amber over 24 hours, red over 48 (the words say it too). */
export function WaitingPill({ hours }: { hours: number }) {
  const { t, lang } = useI18n();
  const level = waitingLevel(hours);
  const span = waitingSpan(hours);
  const time = span.unit === 'lessThanHour' ? t('support.wait.lessThanHour') : t(`support.wait.${span.unit}`, { n: formatDecimal(lang, span.n) });
  const tone = level === 'urgent' ? styles.urgent : level === 'late' ? styles.amber : styles.grey;
  return <span className={`${styles.pill} ${tone}`}>{t('support.inbox.waitingFor', { time })}</span>;
}

/**
 * The top of Solicitări (A3c1): the counters over every request (each one opens the list with its
 * filter; the one matching the list is marked), the warnings at 24 and 48 calendar hours without an
 * answer, and the request whose author has waited longest, with who is responsible.
 */
export function SupportDashboardPanel({
  dashboard,
  filters,
  listPath,
  detailPath,
}: {
  dashboard: SupportDashboard;
  filters: RequestFilters;
  listPath: string;
  detailPath: (id: string) => string;
}) {
  const { t, lang } = useI18n();
  const { counts, oldest } = dashboard;
  const now = new Date(dashboard.now);
  const oldestHours = oldest ? Math.max(0, (now.getTime() - new Date(oldest.waiting_since).getTime()) / 3_600_000) : null;

  return (
    <section className={styles.dashboard} aria-label={t('support.dash.label')}>
      <ul className={`${adminStyles.stats} ${styles.dashStats}`}>
        {TILES.map((tile) => {
          const n = counts[tile.count];
          const warn = tile.warn && n > 0 ? tile.warn : null;
          const current = isCurrent(tile, filters);
          return (
            <li key={tile.count}>
              <Link
                to={`${listPath}${filterSearch(tile.filter, tile.value)}`}
                replace
                aria-current={current ? 'true' : undefined}
                className={[adminStyles.stat, warn === 'late' ? styles.statLate : '', warn === 'urgent' ? styles.statUrgent : '', current ? styles.statCurrent : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className={adminStyles.statNumber}>{formatDecimal(lang, n)}</span>
                <span className={adminStyles.statLabel}>{t(tile.label)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className={styles.oldest}>
        <span className={styles.oldestLabel}>{t('support.dash.oldest')}</span>
        {oldest && oldestHours !== null ? (
          <span className={styles.oldestBody}>
            <Link to={detailPath(oldest.id)} className={styles.oldestTitle}>
              {oldest.title}
            </Link>
            <WaitingPill hours={oldestHours} />
            <span className={styles.muted}>
              {oldest.escalated
                ? t('support.inbox.escalated')
                : oldest.assigned
                  ? t('support.inbox.assigned', { who: [oldest.assigned.display_id, oldest.assigned.name].filter(Boolean).join(' · ') })
                  : t('support.inbox.unassigned')}
            </span>
          </span>
        ) : (
          <span className={styles.muted}>{t('support.dash.oldestNone')}</span>
        )}
      </div>
    </section>
  );
}
