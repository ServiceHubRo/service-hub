import { CalendarDays, SearchX, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { StatusBadge } from '../../components/StatusBadge';
import { fetchBookings } from '../../data/admin';
import { useI18n } from '../../i18n/context';
import {
  BOOKING_STATUS_FILTERS,
  BOOKINGS_MAX,
  BOOKINGS_PAGE,
  isBookingStatusFilter,
  isYmd,
  statusesFor,
} from '../../lib/admin';
import { Money, RowLink } from './parts';
import { adminBookingPath } from './paths';
import { useLiveData } from './useLiveData';
import { useUrlParams } from './useUrlParams';
import { carText, day } from './format';
import styles from './admin.module.css';

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

  return (
    <div className={styles.page}>
      <div>
        <h1>{t('nav.admin.bookings')}</h1>
        {data && <p className={styles.sub}>{t('admin.bookings.count', { shown: data.bookings.length, total: data.total })}</p>}
      </div>

      <div className={styles.controls}>
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

      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {data &&
        (data.bookings.length === 0 ? (
          filtered ? (
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
          )
        ) : (
          <>
            <ul className={styles.list}>
              {data.bookings.map((b) => (
                <li key={b.id}>
                  <RowLink to={adminBookingPath(b.id)}>
                    <span className={styles.rowTop}>
                      <span className={styles.rowTitle}>{(lang === 'ro' ? b.service_ro : b.service_en) ?? b.service_id}</span>
                      <StatusBadge status={b.status} />
                    </span>
                    <span className={styles.rowMeta}>
                      <span className={styles.id}>{b.ref}</span>
                      <span>
                        {day(lang, b.date)}, {b.slot}
                      </span>
                      <span>
                        {b.shop_name}, {b.shop_city}
                      </span>
                    </span>
                    <span className={styles.rowMeta}>
                      <span>
                        {b.client_name || t('admin.deletedAccount')}
                        {b.client_display_id ? ` · ${b.client_display_id}` : ''}
                      </span>
                      <span>
                        {carText(b.car_snapshot)}
                        {b.car_snapshot.plate ? ` · ${b.car_snapshot.plate}` : ''}
                      </span>
                      {b.cost !== null && <Money amount={b.cost} />}
                    </span>
                  </RowLink>
                </li>
              ))}
            </ul>
            {data.bookings.length < data.total && limit < BOOKINGS_MAX && (
              <Button className={styles.more} onClick={() => setLimit((l) => Math.min(l + BOOKINGS_PAGE, BOOKINGS_MAX))}>
                {t('admin.showMore')}
              </Button>
            )}
            {data.bookings.length < data.total && limit >= BOOKINGS_MAX && <p className={styles.muted}>{t('admin.bookings.narrow')}</p>}
          </>
        ))}
    </div>
  );
}
