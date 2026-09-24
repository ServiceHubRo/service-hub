import { CalendarDays, ChevronRight, Printer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { StatusBadge } from '../../../components/StatusBadge';
import type { ShopBooking, ShopBookingsData } from '../../../data/shopBookings';
import { useI18n } from '../../../i18n/context';
import { formatDate } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import { plural } from '../../../i18n/translate';
import { dashboardCounts, todaySchedule, type ShopFilter, type ShopTab } from '../../../lib/shopBookings';
import { formatPhone } from '../../../lib/validators';
import { shopBookingsLink } from '../paths';
import styles from './Dashboard.module.css';

interface StatCard {
  key: string;
  labelKey: MessageKey;
  n: number;
  tone: 'amber' | 'green' | 'blue';
  to: { tab?: ShopTab; filter?: ShopFilter };
}

function carText(b: ShopBooking): string {
  return [b.car_snapshot.make, b.car_snapshot.model].filter(Boolean).join(' ');
}

/**
 * Panou's live part (FR §4.1, P8b, P8c): the six counters — each one opens Programări already
 * filtered, a zero is not tappable —, the note about quotes waiting for the client, and today's
 * schedule, whose rows open the booking and which prints on its own (P17b).
 */
export function TodayBoard({ data, today }: { data: ShopBookingsData; today: string }) {
  const { t, lang } = useI18n();
  const counts = dashboardCounts(data.bookings, today);
  const schedule = todaySchedule(data.bookings, today);

  const cards: StatCard[] = [
    { key: 'requests', labelKey: 'dash.card.requests', n: counts.requests, tone: 'amber', to: { tab: 'cereri' } },
    { key: 'today', labelKey: 'dash.card.today', n: counts.today, tone: 'green', to: { filter: 'azi' } },
    { key: 'week', labelKey: 'dash.card.week', n: counts.week, tone: 'blue', to: { filter: '7zile' } },
    { key: 'inspection', labelKey: 'dash.card.inspection', n: counts.inspection, tone: 'amber', to: { filter: 'constatare' } },
    { key: 'quote', labelKey: 'dash.card.quote', n: counts.quote, tone: 'amber', to: { filter: 'deviz' } },
    { key: 'work', labelKey: 'dash.card.work', n: counts.work, tone: 'green', to: { filter: 'lucru' } },
  ];

  return (
    <>
      <ul className={`${styles.stats} no-print`}>
        {cards.map((c) => {
          const inner = (
            <>
              <span className={`${styles.statNumber} ${styles[c.tone]}`}>{c.n}</span>
              <span className={styles.statLabel}>{t(c.labelKey)}</span>
              {c.n > 0 && <ChevronRight size={16} className={styles.statChevron} aria-hidden="true" />}
            </>
          );
          return (
            <li key={c.key}>
              {c.n > 0 ? (
                <Link to={shopBookingsLink(c.to)} className={styles.stat}>
                  {inner}
                </Link>
              ) : (
                <div className={`${styles.stat} ${styles.statZero}`}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>

      {counts.quote > 0 && (
        <p className={`${styles.quoteNote} no-print`}>
          {t('dash.quoteNote', {
            quotes: plural(lang, 'unit.quotes', counts.quote),
            days: plural(lang, 'unit.days', data.quote_expiry_days),
          })}
        </p>
      )}

      <section className={styles.today} aria-labelledby="dash-today">
        <div className={styles.todayHead}>
          <h2 id="dash-today" className={styles.sectionTitle}>
            {t('dash.today.title')}
            <span className="print-only"> — {formatDate(lang, today)} · {data.shop.name}</span>
          </h2>
          {schedule.length > 0 && (
            <Button variant="ghost" className="no-print" onClick={() => window.print()}>
              <Printer size={18} aria-hidden="true" />
              {t('dash.today.print')}
            </Button>
          )}
        </div>
        {schedule.length === 0 ? (
          <div className="no-print">
            <EmptyState icon={CalendarDays} title={t('dash.today.empty')} />
          </div>
        ) : (
          <>
            <ul className={`${styles.todayList} no-print`}>
              {schedule.map((b) => (
                <li key={b.id}>
                  <Link to={shopBookingsLink({ tab: 'programate', booking: b.id })} className={styles.todayRow}>
                    <span className={`mono ${styles.todayTime}`}>{b.slot}</span>
                    <span className={styles.todayWhat}>
                      <span className={styles.todayService}>{lang === 'ro' ? b.service_ro : b.service_en}</span>
                      <span className={styles.todayMeta}>
                        {[carText(b), b.car_snapshot.plate, b.client_name].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <StatusBadge status={b.status} />
                  </Link>
                </li>
              ))}
            </ul>
            <table className={`${styles.printTable} print-only`}>
              <thead>
                <tr>
                  <th>{t('dash.print.time')}</th>
                  <th>{t('dash.print.service')}</th>
                  <th>{t('dash.print.car')}</th>
                  <th>{t('dash.print.client')}</th>
                  <th>{t('dash.print.status')}</th>
                  <th>{t('dash.print.note')}</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((b) => (
                  <tr key={b.id}>
                    <td className="mono">{b.slot}</td>
                    <td>{lang === 'ro' ? b.service_ro : b.service_en}</td>
                    <td>
                      {carText(b)}
                      {b.car_snapshot.plate && <div className="mono">{b.car_snapshot.plate}</div>}
                    </td>
                    <td>
                      {b.client_name}
                      {b.client_phone && <div className="mono">{formatPhone(b.client_phone)}</div>}
                    </td>
                    <td>{t(`status.${b.status}`)}</td>
                    <td>{b.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </>
  );
}
