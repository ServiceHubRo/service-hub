import { CalendarDays } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { buttonClass } from '../../../components/buttonClass';
import { Chip, ChipRow } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { ListDetailLayout } from '../../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../../components/ListRow';
import { LoadError } from '../../../components/LoadError';
import { PageHeader } from '../../../components/PageHeader';
import { ServiceIcon } from '../../../components/ServiceIcon';
import { StatusPill } from '../../../components/StatusPill';
import { Tabs, TabPanel } from '../../../components/Tabs';
import { splitBookings, type ClientBooking } from '../../../data/bookings';
import { needsAcknowledgement } from '../../../data/noShows';
import { useI18n } from '../../../i18n/context';
import { formatDate } from '../../../i18n/format';
import { bookingServicesText } from '../../../lib/bookingServices';
import { activeOrder, clientTone, ENDED_FILTERS, ENDED_PAGE, endedGroup, waitsForClient, type EndedFilter } from '../../../lib/clientBookings';
import { isActiveStatus } from '../../../lib/status';
import { useListDetail } from '../../../lib/useListDetail';
import { useNow } from '../../../lib/useNow';
import { SEARCH_PATH } from '../paths';
import { ClientBookingDetail } from './ClientBookingDetail';
import { useClientBookings } from './clientBookingsContext';
import styles from './bookings.module.css';

type Tab = 'active' | 'incheiate';

const FILTER_LABEL = {
  all: 'bookings.filter.all',
  done: 'bookings.filter.done',
  cancelled: 'bookings.filter.cancelled',
  noWork: 'bookings.filter.noWork',
} as const;

/**
 * Programări (FR §3.5, P10b; page template A, Eduard 14 Nov 2026): the tabs Active (N) and Încheiate,
 * kept in the address (`?fila=incheiate`). A row is the summary — service, day and time, shop, car,
 * status — and the detail holds everything else: the quote to answer, the documents, cancelling,
 * the review, a no-show to contest. What waits for the client comes first and is marked. From
 * 1024 px the list stands beside the detail; on a phone a row opens it on the whole screen. Ended
 * bookings have quick filters and show the latest 20, then „Mai vechi”. Live through
 * ClientBookingsProvider. `?p=<id>` (a tapped notification) opens that booking, in its tab; with
 * `&recenzie=1` (the review request, T19d) its review form is open.
 */
export function ClientBookingsScreen() {
  const { t, lang } = useI18n();
  const { state, reload, refresh, apply, patch } = useClientBookings();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const reviewFocus = params.get('recenzie') === '1';
  const asked = params.get('p');

  // Arriving here reads the list again quietly.
  useEffect(() => {
    refresh();
  }, [refresh]);

  const data = state.status === 'ready' ? state.data : null;
  const groups = useMemo(() => {
    if (!data) return null;
    const { active, past } = splitBookings(data.bookings);
    return { active: activeOrder(active), past };
  }, [data]);

  // The tab of the booking asked for wins (a notification, a booking that just ended here).
  const askedBooking = asked ? data?.bookings.find((b) => b.id === asked) : undefined;
  const tab: Tab = askedBooking ? (isActiveStatus(askedBooking.status) ? 'active' : 'incheiate') : params.get('fila') === 'incheiate' ? 'incheiate' : 'active';

  const rawFilter = params.get('filtru') as EndedFilter | null;
  const filter: EndedFilter = rawFilter && ENDED_FILTERS.includes(rawFilter) ? rawFilter : 'all';
  const present = useMemo(() => new Set((groups?.past ?? []).map((b) => endedGroup(b.status))), [groups]);
  const filteredPast = useMemo(() => (groups?.past ?? []).filter((b) => filter === 'all' || endedGroup(b.status) === filter), [groups, filter]);
  const [pastShown, setPastShown] = useState(ENDED_PAGE);
  const pastPage = useMemo(() => {
    // A booking asked for further down the list is shown, with all before it.
    const at = asked ? filteredPast.findIndex((b) => b.id === asked) : -1;
    return filteredPast.slice(0, Math.max(pastShown, at + 1));
  }, [filteredPast, pastShown, asked]);

  const shown: ClientBooking[] = tab === 'active' ? (groups?.active ?? []) : pastPage;
  const { wide, selectedId, open, select } = useListDetail(
    shown.map((b) => b.id),
    'p',
  );
  const chosen = shown.find((b) => b.id === selectedId) ?? null;

  function update(change: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(params);
    change(next);
    setParams(next, { replace: true });
  }
  const setTab = (next: Tab) =>
    update((p) => {
      if (next === 'active') p.delete('fila');
      else p.set('fila', next);
      p.delete('p');
      p.delete('recenzie');
    });
  const setFilter = (next: EndedFilter) => {
    setPastShown(ENDED_PAGE);
    update((p) => {
      if (next === 'all') p.delete('filtru');
      else p.set('filtru', next);
      p.delete('p');
    });
  };

  const backParams = new URLSearchParams(params);
  backParams.delete('p');
  backParams.delete('recenzie');
  if (tab === 'incheiate') backParams.set('fila', 'incheiate');
  const backTo = `${pathname}${backParams.size ? `?${backParams.toString()}` : ''}`;

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('bookings.loadError')} onRetry={reload} />;
  else if (groups && groups.active.length + groups.past.length === 0)
    list = (
      <EmptyState
        icon={CalendarDays}
        title={t('bookings.empty')}
        body={t('bookings.emptyBody')}
        action={
          <Link to={SEARCH_PATH} className={buttonClass('primary')}>
            {t('bookings.findShop')}
          </Link>
        }
      />
    );
  else if (shown.length === 0)
    list = (
      <EmptyState
        icon={CalendarDays}
        title={t(tab === 'active' ? 'bookings.emptyActive' : 'bookings.emptyPast')}
        action={
          tab === 'active' ? (
            <Link to={SEARCH_PATH} className={buttonClass('primary')}>
              {t('bookings.findShop')}
            </Link>
          ) : undefined
        }
      />
    );
  else
    list = (
      <>
        <ListRows label={tab === 'active' ? t('bookings.active') : t('bookings.past')}>
          {shown.map((b) => {
            const car = [[b.car_snapshot.make, b.car_snapshot.model].filter(Boolean).join(' '), b.car_snapshot.plate].filter(Boolean).join(' · ');
            return (
              <ListRow
                key={b.id}
                icon={<ServiceIcon name={b.service?.icon} size={20} />}
                title={bookingServicesText(lang, b.service, b.extra_services, b.service_id)}
                detail={[`${formatDate(lang, b.date)}, ${b.slot.slice(0, 5)}`, b.shop?.name, car, b.ref].filter(Boolean).join(' · ')}
                status={<StatusPill tone={clientTone(b)}>{t(`status.${b.status}`)}</StatusPill>}
                attention={waitsForClient(b)}
                selected={wide && b.id === selectedId}
                onSelect={() => select(b.id)}
              />
            );
          })}
        </ListRows>
        {tab === 'incheiate' && pastPage.length < filteredPast.length && (
          <div className={styles.more}>
            <Button variant="ghost" onClick={() => setPastShown(pastPage.length + ENDED_PAGE)}>
              {t('bookings.older')}
            </Button>
          </div>
        )}
      </>
    );

  return (
    <ListDetailLayout
      wide={wide}
      open={open}
      backTo={backTo}
      backLabel={t('nav.bookings')}
      header={
        <>
          <PageHeader
            title={t('nav.bookings')}
            tabs={
              <Tabs
                id="bookings"
                label={t('bookings.tabs')}
                value={tab}
                onChange={setTab}
                items={[
                  { key: 'active', label: t('bookings.active'), count: groups ? groups.active.length : undefined },
                  { key: 'incheiate', label: t('bookings.past') },
                ]}
              />
            }
          />
          {/* T53: from the second no-show that counts, a neutral notice; never a score. */}
          {data?.noShows && data.noShows.count >= 2 && (
            <Banner tone="warning">
              {t(needsAcknowledgement(data.noShows) ? 'bookings.noShows.ack' : 'bookings.noShows', { n: data.noShows.count })}
            </Banner>
          )}
          {tab === 'incheiate' && present.size > 1 && (
            <ChipRow label={t('bookings.filter.label')}>
              {ENDED_FILTERS.filter((f) => f === 'all' || present.has(f)).map((f) => (
                <Chip key={f} selected={f === filter} onClick={() => setFilter(f)}>
                  {t(FILTER_LABEL[f])}
                </Chip>
              ))}
            </ChipRow>
          )}
        </>
      }
      list={
        <TabPanel id="bookings" value={tab}>
          {list}
        </TabPanel>
      }
      detail={
        chosen && (
          <ClientBookingDetail
            // A review request tapped while this screen is open starts the detail again, form open.
            key={`${chosen.id}${reviewFocus && chosen.id === asked ? ':review' : ''}`}
            booking={chosen}
            reviewWindowDays={data?.reviewWindowDays ?? 60}
            now={now}
            onDone={(row) => {
              apply(row);
              // The booking stays open after an action, in its tab even when it has just ended.
              if (asked !== row.id) update((p) => p.set('p', row.id));
            }}
            onReviewed={(id, review) => patch(id, { review })}
            onStale={refresh}
            openReview={reviewFocus && chosen.id === asked}
            noShow={
              chosen.status === 'no_show'
                ? {
                    dispute: data?.noShows?.disputes.find((d) => d.booking_id === chosen.id) ?? null,
                    disputable: data?.noShows?.disputable.includes(chosen.id) ?? false,
                  }
                : undefined
            }
            onDisputed={refresh}
          />
        )
      }
    />
  );
}
