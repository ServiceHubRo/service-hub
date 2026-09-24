import { CalendarCheck, Inbox, Unlink, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Chip } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { Tabs } from '../../../components/Tabs';
import { RpcError, type Booking } from '../../../data/rpc';
import type { ShopBooking } from '../../../data/shopBookings';
import { useI18n } from '../../../i18n/context';
import { formatDate, ymdInBucharest } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import {
  matchesFilter,
  parseFilter,
  parseTab,
  tabList,
  tabOf,
  type ShopFilter,
  type ShopTab,
} from '../../../lib/shopBookings';
import { isActiveStatus, type BookingStatus } from '../../../lib/status';
import { useNow } from '../../../lib/useNow';
import { ShopBookingCard } from './ShopBookingCard';
import { useShopBookings } from './shopBookingsContext';
import styles from './shopBookings.module.css';

const FILTER_LABEL: Record<ShopFilter, MessageKey> = {
  azi: 'sb.filter.azi',
  '7zile': 'sb.filter.7zile',
  constatare: 'sb.filter.constatare',
  deviz: 'sb.filter.deviz',
  lucru: 'sb.filter.lucru',
};

/** What happened after an action, and where the booking went. */
interface Notice {
  text: string;
  /** Set when the booking left the list on screen but is still active. */
  show?: { tab: ShopTab; booking: string };
}

const DONE_MESSAGE: Partial<Record<BookingStatus, MessageKey>> = {
  confirmed: 'sb.done.confirmed',
  declined: 'sb.done.declined',
  cancelled: 'sb.done.cancelled',
  no_show: 'sb.done.no_show',
  in_inspection: 'sb.done.in_inspection',
  quote_sent: 'sb.done.quote_sent',
  in_progress: 'sb.done.in_progress',
  done: 'sb.done.done',
};

function doneMessage(before: BookingStatus, after: BookingStatus, moved: boolean): MessageKey | null {
  if (moved) return 'sb.done.rescheduled';
  if (before === 'quote_sent' && after === 'quote_sent') return 'sb.done.quote_replaced';
  if (before === 'quote_sent' && after === 'in_inspection') return 'sb.done.quote_withdrawn';
  return DONE_MESSAGE[after] ?? null;
}

/**
 * Programări of the shop (FR §4.2, P8, P8c): the tabs Cereri (requests waiting for an answer) and
 * Programate (confirmed until done), each with its count. A Panou card opens the list already
 * filtered (`?filtru=`), a row of "Programul de azi" opens one booking (`?p=`); a chip names the
 * filter and clears it. Live through ShopBookingsProvider.
 */
export function ShopBookingsScreen() {
  const { t, lang } = useI18n();
  const { state, reload, refresh, apply } = useShopBookings();
  const [params, setParams] = useSearchParams();
  const now = useNow();
  const today = ymdInBucharest(now);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Arriving here reads the list again quietly (settings such as the fee may have changed).
  useEffect(() => {
    refresh();
  }, [refresh]);

  const onlyId = params.get('p');
  const filter = onlyId ? null : parseFilter(params.get('filtru'));
  const data = state.status === 'ready' ? state.data : null;
  const only = data && onlyId ? (data.bookings.find((b) => b.id === onlyId) ?? null) : null;
  const tab: ShopTab = only ? tabOf(only.status) : filter ? 'programate' : parseTab(params.get('tab'));

  const lists = useMemo(
    () => (data ? { cereri: tabList(data.bookings, 'cereri'), programate: tabList(data.bookings, 'programate') } : null),
    [data],
  );

  function go(next: { tab: ShopTab; booking?: string }) {
    const p = new URLSearchParams({ tab: next.tab });
    if (next.booking) p.set('p', next.booking);
    setParams(p, { replace: true });
  }

  function onDone(before: ShopBooking, after: Booking) {
    apply(after);
    const status = after.status as BookingStatus;
    const moved = before.date !== after.date || before.slot !== after.slot.slice(0, 5);
    const when = `${formatDate(lang, after.date)}, ${after.slot.slice(0, 5)}`;
    const key = doneMessage(before.status, status, moved);
    if (!key) return;
    const text = t(key, { ref: after.ref, when });
    // Still active but no longer in the list on screen (a request confirmed from Cereri, a
    // booking moved off today's filter): offer the way to it.
    const stillShown =
      onlyId === after.id ||
      (tabOf(status) === tab && (!filter || matchesFilter({ status, date: after.date, slot: after.slot }, filter, today)));
    setNotice({
      text,
      show: isActiveStatus(status) && !stillShown ? { tab: tabOf(status), booking: after.id } : undefined,
    });
  }

  let body;
  if (state.status === 'loading') body = <SkeletonList />;
  else if (state.status === 'error') {
    body =
      state.error instanceof RpcError && state.error.code === 'not_allowed' ? (
        <EmptyState icon={Unlink} title={t('settings.noShop')} />
      ) : (
        <LoadError message={t('sb.loadError')} onRetry={reload} />
      );
  } else if (data && lists) {
    const list = onlyId ? (only ? [only] : []) : lists[tab].filter((b) => !filter || matchesFilter(b, filter, today));
    const chip = onlyId
      ? t('sb.filter.one', { ref: only?.ref ?? '' })
      : filter
        ? t(FILTER_LABEL[filter])
        : null;
    body = (
      <>
        <Tabs
          label={t('nav.bookings')}
          value={tab}
          onChange={(key) => {
            setNotice(null);
            go({ tab: key });
          }}
          items={[
            { key: 'cereri', label: t('sb.tab.requests'), count: lists.cereri.length },
            { key: 'programate', label: t('sb.tab.scheduled'), count: lists.programate.length },
          ]}
        />
        {chip && (
          <div className={styles.filterRow}>
            <Chip selected onClick={() => go({ tab })}>
              {chip}
              <X size={14} aria-hidden="true" />
              <span className="visually-hidden">{t('sb.filter.clear')}</span>
            </Chip>
          </div>
        )}
        {notice && (
          <Banner
            tone="info"
            action={
              <div className={styles.noticeButtons}>
                {notice.show && (
                  <Button
                    onClick={() => {
                      const show = notice.show!;
                      setNotice(null);
                      go(show);
                    }}
                  >
                    {t('sb.done.show')}
                  </Button>
                )}
                <button type="button" className={styles.noticeClose} aria-label={t('common.close')} onClick={() => setNotice(null)}>
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            }
          >
            {notice.text}
          </Banner>
        )}
        {list.length === 0 ? (
          onlyId ? (
            <EmptyState icon={CalendarCheck} title={t('sb.empty.gone')} body={t('sb.empty.goneBody')} />
          ) : filter ? (
            <EmptyState
              icon={CalendarCheck}
              title={t('sb.empty.filtered')}
              action={
                <Button variant="primary" onClick={() => go({ tab })}>
                  {t('sb.filter.clear')}
                </Button>
              }
            />
          ) : tab === 'cereri' ? (
            <EmptyState icon={Inbox} title={t('sb.empty.requests')} body={t('sb.empty.requestsBody')} />
          ) : (
            <EmptyState icon={CalendarCheck} title={t('sb.empty.scheduled')} body={t('sb.empty.scheduledBody')} />
          )
        ) : (
          <ul className={styles.list} aria-label={tab === 'cereri' ? t('sb.tab.requests') : t('sb.tab.scheduled')}>
            {list.map((b) => (
              <li key={b.id}>
                <ShopBookingCard
                  booking={b}
                  shopId={data.shop.id}
                  fee={data.shop.inspection_fee}
                  expiryDays={data.quote_expiry_days}
                  now={now}
                  onDone={onDone}
                  onStale={refresh}
                />
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <div className={styles.page}>
      <h1>{t('nav.bookings')}</h1>
      {body}
    </div>
  );
}
