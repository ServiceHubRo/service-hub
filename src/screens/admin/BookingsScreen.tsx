import { CalendarDays, SearchX, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { SelectField } from '../../components/SelectField';
import { buttonClass } from '../../components/buttonClass';
import { DetailFacts, DetailPane, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { BookingStatusPill } from '../../components/StatusPill';
import { fetchBookings, type AdminBookingListRow } from '../../data/admin';
import { ExportButton } from './ExportButton';
import { adminZoneBack } from '../../app/adminZones';
import { useI18n } from '../../i18n/context';
import {
  BOOKING_STATUS_FILTERS,
  BOOKINGS_MAX,
  BOOKINGS_PAGE,
  isBookingStatusFilter,
  isYmd,
  statusesFor,
} from '../../lib/admin';
import { useListDetail } from '../../lib/useListDetail';
import { Money } from './parts';
import { ADMIN_BOOKINGS_PATH, adminBookingPath, adminClientPath, adminShopPath } from './paths';
import { useLiveData } from './useLiveData';
import { useUrlParams } from './useUrlParams';
import { carText, day } from './format';
import styles from './admin.module.css';
import { PageHeader } from '../../components/PageHeader';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_BOOKINGS_PATH);

const LIVE = [{ table: 'bookings' }];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rezervări (FR §5.4, P20): every booking of the platform, newest appointment first, filtered in the
 * database by status, text (code, plate, client, shop), appointment days, one shop or one client.
 * The filters live in the address (?q=&stare=&de_la=&pana_la=&service=&client=). 100 at a time.
 * Live: a new or changed booking reads the list again quietly.
 */
export function BookingsScreen() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const { params, setParam, text, setText } = useUrlParams();
  const statusParam = params.get('stare');
  const status = isBookingStatusFilter(statusParam) ? statusParam : 'all';
  const from = isYmd(params.get('de_la')) ? params.get('de_la')! : '';
  const to = isYmd(params.get('pana_la')) ? params.get('pana_la')! : '';
  const shopId = UUID.test(params.get('service') ?? '') ? params.get('service')! : undefined;
  const clientId = UUID.test(params.get('client') ?? '') ? params.get('client')! : undefined;
  const q = params.get('q') ?? '';
  const [limit, setLimit] = useState(BOOKINGS_PAGE);

  const load = useCallback(
    () => fetchBookings({ statuses: statusesFor(status), from: from || undefined, to: to || undefined, q, shopId, clientId, limit }),
    [status, from, to, q, shopId, clientId, limit],
  );
  const { state, reload } = useLiveData(load, LIVE, 'admin-bookings');
  const data = state.status === 'ready' ? state.data : null;
  const filtered = q !== '' || status !== 'all' || from !== '' || to !== '' || shopId !== undefined || clientId !== undefined;

  const clearAll = () => {
    setText('');
    setLimit(BOOKINGS_PAGE);
    setParam({ q: null, stare: null, de_la: null, pana_la: null, service: null, client: null });
  };

  // Page template A (docs/MODEL_DE_FOLOSIRE.md P8): one row per booking, the chosen one beside the list
  // from 1024 px (in its place below); the whole booking is one tap away („Deschide programarea”).
  const rows = data ? data.bookings : [];
  const { wide, selectedId, open, select } = useListDetail(
    rows.map((b) => b.id),
    'programare',
  );
  const chosen = rows.find((b) => b.id === selectedId) ?? null;

  const header = (
    <>
      <PageHeader back={{ to: ZONE_BACK.to, label: t(ZONE_BACK.label) }} title={t('nav.admin.bookings')} subtitle={data ? t('admin.bookings.count', { shown: data.bookings.length, total: data.total }) : undefined} />

      <div className={styles.controls}>
        {/* The search and the dates end at the same edge; the Excel button stands at the right of the search. */}
        <div className={styles.filterGrid}>
          <SearchField
            id="admin-bookings-q"
            label={t('admin.bookings.search')}
            placeholder={t('admin.bookings.search')}
            value={text}
            onChange={setText}
            onClear={() => {
              setText('');
              setParam({ q: null });
            }}
            clearLabel={t('admin.search.clear')}
          />
          <div className={styles.exportCell}>
            <ExportButton
              kind="bookings"
              filters={{ statuses: statusesFor(status), from: from || undefined, to: to || undefined, q: q || undefined, shop_id: shopId, client_id: clientId }}
            />
          </div>
          <div className={styles.dates}>
            <SelectField
              label={t('admin.bookings.status')}
              value={status}
              onChange={(e) => setParam({ stare: e.target.value === 'all' ? null : e.target.value })}
              options={BOOKING_STATUS_FILTERS.map((f) => ({
                value: f,
                label: f === 'all' ? t('admin.bookings.allStatuses') : f === 'active' ? t('admin.bookings.active') : t(`status.${f}`),
              }))}
            />
            <Field label={t('admin.bookings.from')} type="date" value={from} max={to || undefined} onChange={(e) => setParam({ de_la: e.target.value || null })} />
            <Field label={t('admin.bookings.to')} type="date" value={to} min={from || undefined} onChange={(e) => setParam({ pana_la: e.target.value || null })} />
          </div>
        </div>
        {(shopId || clientId) && (
          <div className={styles.actions}>
            <Button onClick={() => setParam({ service: null, client: null })}>
              <X size={16} aria-hidden="true" />
              {shopId
                ? t('admin.bookings.oneShop', { name: data?.bookings[0]?.shop_name ?? '…' })
                : t('admin.bookings.oneClient', { name: data?.bookings[0]?.client_display_id ?? '…' })}
            </Button>
          </div>
        )}
      </div>
    </>
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('admin.loadError')} onRetry={reload} />;
  else if (data && data.bookings.length === 0)
    list = filtered ? (
      <EmptyState
        icon={SearchX}
        title={t('admin.noResults')}
        action={
          <Button variant="primary" onClick={clearAll}>
            {t('admin.clearFilters')}
          </Button>
        }
      />
    ) : (
      <EmptyState icon={CalendarDays} title={t('admin.bookings.empty')} />
    );
  else if (data)
    list = (
      <>
        <ListRows label={t('nav.admin.bookings')}>
          {data.bookings.map((b) => (
            <ListRow
              key={b.id}
              icon={<CalendarDays size={20} />}
              title={(lang === 'ro' ? b.service_ro : b.service_en) ?? b.service_id}
              detail={[b.ref, `${day(lang, b.date)}, ${b.slot}`, `${b.shop_name}, ${b.shop_city}`].join(' · ')}
              status={<BookingStatusPill status={b.status} viewer="admin" />}
              selected={wide && b.id === selectedId}
              onSelect={() => select(b.id)}
            />
          ))}
        </ListRows>
            {data.bookings.length < data.total && limit < BOOKINGS_MAX && (
              <Button className={styles.more} onClick={() => setLimit((l) => Math.min(l + BOOKINGS_PAGE, BOOKINGS_MAX))}>
                {t('admin.showMore')}
              </Button>
            )}
            {data.bookings.length < data.total && limit >= BOOKINGS_MAX && <p className={styles.muted}>{t('admin.bookings.narrow')}</p>}
      </>
    );

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={pathname}
        backLabel={t('nav.admin.bookings')}
        header={header}
        list={list}
        detail={chosen && <BookingDetail key={chosen.id} b={chosen} />}
      />
    </div>
  );
}

/** One booking in the list's detail: who, where, what, how much; the whole booking is „Deschide programarea”. */
function BookingDetail({ b }: { b: AdminBookingListRow }) {
  const { t, lang } = useI18n();
  return (
    <DetailPane
      id={b.id}
      icon={<CalendarDays size={20} />}
      title={(lang === 'ro' ? b.service_ro : b.service_en) ?? b.service_id}
      detail={b.ref}
      status={<BookingStatusPill status={b.status} viewer="admin" />}
      actions={
        <Link className={buttonClass('secondary')} to={adminBookingPath(b.id)}>
          {t('admin.bookings.open')}
        </Link>
      }
    >
      <DetailFacts
        items={[
          { label: t('admin.booking.when'), value: `${day(lang, b.date)}, ${b.slot}` },
          {
            label: t('admin.booking.shop'),
            value: (
              <Link className={styles.link} to={adminShopPath(b.shop_id)}>
                {b.shop_name}, {b.shop_city}
              </Link>
            ),
          },
          {
            label: t('admin.booking.client'),
            value: b.client_id ? (
              <Link className={styles.link} to={adminClientPath(b.client_id)}>
                {[b.client_name, b.client_display_id].filter(Boolean).join(' · ')}
              </Link>
            ) : (
              t('admin.deletedAccount')
            ),
          },
          { label: t('admin.booking.car'), value: [carText(b.car_snapshot), b.car_snapshot.plate].filter(Boolean).join(' · ') || '—' },
          { label: t('admin.booking.cost'), value: b.cost !== null ? <Money amount={b.cost} /> : '—' },
        ]}
      />
    </DetailPane>
  );
}
