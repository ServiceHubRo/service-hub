import { CalendarCheck, CalendarPlus, Inbox, Unlink, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLiveSearchParams } from '../../../app/useLiveSearchParams';
import { Banner } from '../../../components/Banner';
import { SuccessCheck } from '../../../components/SuccessCheck';
import { Button } from '../../../components/Button';
import { buttonClass } from '../../../components/buttonClass';
import { ActiveFilters } from '../../../components/Filters';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { PageHeader } from '../../../components/PageHeader';
import { ListDetailLayout } from '../../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../../components/ListRow';
import { ServiceIcon } from '../../../components/ServiceIcon';
import { BookingStatusPill } from '../../../components/StatusPill';
import { ViewSelect } from '../../../components/ViewSelect';
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
import { motionOn } from '../../../lib/motion';
import { isActiveStatus, type BookingStatus } from '../../../lib/status';
import { rowServicesText } from '../../../lib/bookingServices';
import { useListDetail } from '../../../lib/useListDetail';
import { useNow } from '../../../lib/useNow';
import { ADD_BOOKING_PATH } from '../paths';
import type { AddedBookingState } from './AddBookingScreen';
import { ShopBookingDetail } from './ShopBookingCard';
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
/** Router state of a screen that leads back here after a write (the quote editor, the intake sheet). */
export interface DoneState {
  done: { key: MessageKey; ref: string; date: string; slot: string };
}

interface Notice {
  /** Kept as a key, not a sentence, so it follows a language switch. */
  key: MessageKey;
  ref: string;
  date: string;
  slot: string;
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
  approved: 'sb.done.approved',
  quote_refused: 'sb.done.quote_refused',
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
 * filtered (`?filtru=`), a row of "Programul de azi" opens one booking (`?p=`), in its tab; a chip names
 * the filter and clears it. Live through ShopBookingsProvider.
 */
export function ShopBookingsScreen() {
  const { t, lang } = useI18n();
  const { state, reload, refresh, apply, isFresh } = useShopBookings();
  const [params, setParams] = useLiveSearchParams();
  const now = useNow();
  const today = ymdInBucharest(now);
  const location = useLocation();
  // Back from "Adaugă programare": say where the new booking went.
  const [notice, setNotice] = useState<Notice | null>(() => {
    const state = location.state as Partial<AddedBookingState & DoneState> | null;
    // Back from the quote editor or the intake sheet (T50): what went out.
    if (state?.done) return state.done;
    const added = state?.added;
    return added
      ? { key: added.invited ? 'sb.done.addedSms' : 'sb.done.added', ref: added.ref, date: added.date, slot: added.slot }
      : null;
  });

  // Arriving here reads the list again quietly (settings such as the fee may have changed).
  useEffect(() => {
    refresh();
  }, [refresh]);

  const filter = parseFilter(params.get('filtru'));
  const data = state.status === 'ready' ? state.data : null;
  // The open booking (`?p=`) names the tab only when the address does not (a notification): a booking
  // confirmed from Cereri leaves that list, and the list stays where it was.
  const askedTab = params.get('tab');
  const askedId = askedTab ? null : params.get('p');
  const asked = data && askedId ? (data.bookings.find((b) => b.id === askedId) ?? null) : null;
  const tab: ShopTab = asked ? tabOf(asked.status) : filter ? 'programate' : parseTab(askedTab);
  // Once read, the address names its tab, so a later change of the open booking does not move the list.
  useEffect(() => {
    if (!data || askedTab) return;
    const next = new URLSearchParams(params);
    next.set('tab', tab);
    setParams(next, { replace: true });
  }, [data, askedTab, tab, params, setParams]);

  const lists = useMemo(
    () => (data ? { cereri: tabList(data.bookings, 'cereri'), programate: tabList(data.bookings, 'programate') } : null),
    [data],
  );

  // Page template A (docs/MODEL_DE_FOLOSIRE.md P8): one row per booking, the chosen one (`?p=`) beside the
  // list from 1024 px (in its place below). A Panou card or a notification opens its booking, in its tab.
  const shown = lists ? lists[tab].filter((b) => !filter || matchesFilter(b, filter, today)) : [];
  const { wide, selectedId, open, select } = useListDetail(
    shown.map((b) => b.id),
    'p',
  );
  const chosen = shown.find((b) => b.id === selectedId) ?? null;
  const { pathname } = location;

  function go(next: { tab: ShopTab; booking?: string }) {
    const p = new URLSearchParams({ tab: next.tab });
    if (next.booking) p.set('p', next.booking);
    setParams(p, { replace: true });
  }

  function onDone(before: ShopBooking, after: Booking) {
    apply(after);
    const status = after.status as BookingStatus;
    const moved = before.date !== after.date || before.slot !== after.slot.slice(0, 5);
    const key = doneMessage(before.status, status, moved);
    if (!key) return;
    // Still active but no longer in the list on screen (a request confirmed from Cereri, a
    // booking moved off today's filter): offer the way to it.
    const stillShown = tabOf(status) === tab && (!filter || matchesFilter({ status, date: after.date, slot: after.slot }, filter, today));
    setNotice({
      key,
      ref: after.ref,
      date: after.date,
      slot: after.slot.slice(0, 5),
      show: isActiveStatus(status) && !stillShown ? { tab: tabOf(status), booking: after.id } : undefined,
    });
  }

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') {
    list =
      state.error instanceof RpcError && state.error.code === 'not_allowed' ? (
        <EmptyState icon={Unlink} title={t('settings.noShop')} />
      ) : (
        <LoadError message={t('sb.loadError')} onRetry={reload} />
      );
  } else if (data && lists) {
    list =
      shown.length === 0 ? (
        filter ? (
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
        <ListRows label={tab === 'cereri' ? t('sb.tab.requests') : t('sb.tab.scheduled')}>
          {shown.map((b) => {
            const car = [[b.car_snapshot.make, b.car_snapshot.model].filter(Boolean).join(' '), b.car_snapshot.plate].filter(Boolean).join(' · ');
            return (
              <ListRow
                key={b.id}
                icon={<ServiceIcon name={b.service_icon} size={20} />}
                title={rowServicesText(lang, b)}
                detail={[`${formatDate(lang, b.date)}, ${b.slot}`, b.client_name || t('sb.card.deletedClient'), car || t('sb.card.noCar'), b.ref].join(' · ')}
                status={<BookingStatusPill status={b.status} viewer="shop" />}
                attention={b.status === 'pending'}
                selected={wide && b.id === selectedId}
                fresh={isFresh(b.id) && motionOn('newRequestGlow')}
                onSelect={() => select(b.id)}
              />
            );
          })}
        </ListRows>
      );
  }

  // The answer of an action: above the list, or at the top of the open detail on a phone (the header is hidden then).
  const banner = notice && (
        <Banner
          key={`${notice.key}:${notice.ref}`}
          tone="info"
          icon={<SuccessCheck size={22} />}
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
          {t(notice.key, { ref: notice.ref, when: `${formatDate(lang, notice.date)}, ${notice.slot}` })}
        </Banner>
  );

  const chip = filter ? t(FILTER_LABEL[filter]) : null;
  const header = (
    <>
      <PageHeader
        title={t('nav.bookings')}
        actions={
          state.status === 'ready' && (
            <Link to={ADD_BOOKING_PATH} className={buttonClass('primary')} aria-label={t('wi.add')}>
              <CalendarPlus size={18} aria-hidden="true" />
              {t('action.add')}
            </Link>
          )
        }
      />
      {lists && (
        <ViewSelect
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
      )}
      {chip && <ActiveFilters items={[{ key: 'focus', label: chip }]} onClearAll={() => go({ tab })} />}
      {!open && banner}
    </>
  );

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={`${pathname}?tab=${tab}`}
        backLabel={t('nav.bookings')}
        header={header}
        list={list}
        detail={
          chosen &&
          data && (
            <ShopBookingDetail key={chosen.id} booking={chosen} shopId={data.shop.id} shopName={data.shop.name} now={now} onDone={onDone} onStale={refresh} top={open ? banner : undefined} />
          )
        }
      />
    </div>
  );
}
