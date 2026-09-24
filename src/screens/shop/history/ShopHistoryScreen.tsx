import { ChevronDown, Download, History as HistoryIcon, Phone, Printer, SearchX } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Chip, ChipRow } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SearchField } from '../../../components/SearchField';
import { ServiceIcon } from '../../../components/ServiceIcon';
import { SkeletonList } from '../../../components/Skeleton';
import { StatusBadge } from '../../../components/StatusBadge';
import { subscribeRows } from '../../../data/realtime';
import { fetchShopHistory, type ShopHistoryItem } from '../../../data/shopHistory';
import { useI18n, type I18nValue } from '../../../i18n/context';
import { formatDayMonth, formatKm, formatMoney, ymdInBucharest } from '../../../i18n/format';
import { plural, type Lang } from '../../../i18n/translate';
import {
  csvAmount,
  csvFormat,
  endedDay,
  filterHistory,
  HISTORY_FILTERS,
  HISTORY_PERIODS,
  historyTotals,
  isHistoryFilter,
  isHistoryPeriod,
  toCsv,
} from '../../../lib/history';
import { useLoad } from '../../../lib/useLoad';
import { useNow } from '../../../lib/useNow';
import { formatPhone, normalizePhone } from '../../../lib/validators';
import { HistoryQuote } from '../../history/HistoryQuote';
import { MessageLink } from '../../messages/MessageLink';
import styles from '../../history/history.module.css';

function carText(b: ShopHistoryItem): string {
  return [b.car_snapshot.make, b.car_snapshot.model, b.car_snapshot.year].filter(Boolean).join(' ');
}

function serviceText(b: ShopHistoryItem, lang: Lang): string {
  return (lang === 'ro' ? b.service_ro : b.service_en) ?? b.service_id;
}

/**
 * Istoric reparații (FR §4.3, P16b): every finished job of the shop — done, quote refused or
 * expired, canceled, no-show — newest first. Search by plate, car, client, service or odometer;
 * status and period chips; totals of what is shown; a card opens with the full quote, the work,
 * the odometer, the client's note and the conversation. The filtered list downloads as CSV and
 * prints as a table. Filters live in the address (?q=&filtru=&perioada=), so Back keeps them.
 */
export function ShopHistoryScreen() {
  const { t, lang } = useI18n();
  const { state, reload, setData } = useLoad(fetchShopHistory);
  const [params, setParams] = useSearchParams();
  const filterParam = params.get('filtru');
  const periodParam = params.get('perioada');
  const filter = isHistoryFilter(filterParam) ? filterParam : 'all';
  const period = isHistoryPeriod(periodParam) ? periodParam : 'all';
  const now = useNow();
  const today = ymdInBucharest(now);

  // Changes start from the address as it is right now, so a chip tapped while the typing timer
  // fires never loses either change.
  const setParamsRef = useRef(setParams);
  useEffect(() => {
    setParamsRef.current = setParams;
  }, [setParams]);
  const setParam = useCallback((changes: Record<string, string | null>) => {
    const current = window.location.search.replace(/^\?/, '');
    const next = new URLSearchParams(current);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (next.toString() !== current) setParamsRef.current(next, { replace: true });
  }, []);

  const [text, setText] = useState(() => params.get('q') ?? '');
  useEffect(() => {
    const id = window.setTimeout(() => setParam({ q: text.trim() ? text : null }), 250);
    return () => window.clearTimeout(id);
  }, [text, setParam]);
  // The list follows the typing without holding the field back on a long history.
  const query = useDeferredValue(text);

  // Live (CLAUDE.md §6.9): a job finished, refused or canceled on another device shows up here;
  // several changes in a row cost one read, and an older answer never replaces a newer one.
  const shopId = state.status === 'ready' ? state.data.shop.id : null;
  useEffect(() => {
    if (!shopId) return;
    let timer: number | undefined;
    let latest = 0;
    let alive = true;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const mine = ++latest;
        fetchShopHistory().then(
          (data) => {
            if (alive && mine === latest) setData(data);
          },
          () => {}, // the list on screen stays; the next change or reconnect reads again
        );
      }, 300);
    };
    const unsubscribe = subscribeRows({
      channel: `shop-history:${shopId}`,
      table: 'bookings',
      filter: `shop_id=eq.${shopId}`,
      onChange: refresh,
      onResync: refresh,
    });
    return () => {
      alive = false;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [shopId, setData]);

  const all = state.status === 'ready' ? state.data.bookings : null;
  const shown = useMemo(
    () => (all ? filterHistory(all, { query, filter, period, today }) : []),
    [all, query, filter, period, today],
  );
  const totals = historyTotals(shown);

  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearFilters = () => {
    setText('');
    setParam({ q: null, filtru: null, perioada: null });
  };

  const filtered = text.trim() !== '' || filter !== 'all' || period !== 'all';

  return (
    <div className={styles.page}>
      <div>
        <h1>{t('hist.title')}</h1>
        {all && all.length > 0 && (
          <p className={styles.sub}>
            {t('hist.totals', { jobs: plural(lang, 'unit.repairs', totals.jobs), amount: formatMoney(lang, totals.revenue) })}
          </p>
        )}
        {state.status === 'ready' && (
          <p className={`${styles.sub} print-only`}>
            {t('hist.printedOn', { shop: state.data.shop.name, date: formatDayMonth(lang, now) })}
          </p>
        )}
      </div>

      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('hist.loadError')} onRetry={reload} />}
      {all && all.length === 0 && <EmptyState icon={HistoryIcon} title={t('hist.empty')} body={t('hist.emptyBody')} />}

      {all && all.length > 0 && (
        <>
          <div className={`${styles.controls} no-print`}>
            <SearchField
              id="history-q"
              label={t('hist.search.label')}
              placeholder={t('hist.search.placeholder')}
              value={text}
              onChange={setText}
              onClear={() => {
                setText('');
                setParam({ q: null });
              }}
              clearLabel={t('hist.search.clear')}
            />
            <div className={styles.filters}>
              <ChipRow label={t('hist.filter.label')}>
                {HISTORY_FILTERS.map((f) => (
                  <Chip key={f} selected={filter === f} onClick={() => setParam({ filtru: f === 'all' ? null : f })}>
                    {t(`hist.filter.${f}`)}
                  </Chip>
                ))}
              </ChipRow>
              <ChipRow label={t('hist.period.label')}>
                {HISTORY_PERIODS.map((p) => (
                  <Chip key={p} selected={period === p} onClick={() => setParam({ perioada: p === 'all' ? null : p })}>
                    {t(`hist.period.${p}`)}
                  </Chip>
                ))}
              </ChipRow>
            </div>
            {shown.length > 0 && (
              <div className={styles.tools}>
                <Button variant="ghost" className={styles.tool} onClick={() => downloadCsv(shown, lang, t, today)}>
                  <Download size={18} aria-hidden="true" />
                  {t('hist.download')}
                </Button>
                <Button variant="ghost" className={styles.tool} onClick={() => window.print()}>
                  <Printer size={18} aria-hidden="true" />
                  {t('hist.print')}
                </Button>
              </div>
            )}
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={text.trim() ? t('hist.noResults', { query: text.trim() }) : t('hist.noResultsFilters')}
              action={
                filtered ? (
                  <Button variant="primary" onClick={clearFilters}>
                    {t('hist.clearFilters')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <ul className={`${styles.list} no-print`}>
                {shown.map((b) => (
                  <li key={b.id}>
                    <HistoryCard item={b} open={open.has(b.id)} onToggle={() => toggle(b.id)} />
                  </li>
                ))}
              </ul>
              <PrintTable items={shown} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/** One finished job (P16b): summary as a button; opened, the whole record. */
function HistoryCard({ item: b, open, onToggle }: { item: ShopHistoryItem; open: boolean; onToggle: () => void }) {
  const { t, lang } = useI18n();
  const detailsId = `history-${b.id}`;
  const car = carText(b);
  const plate = b.car_snapshot.plate;
  const phone = b.client_phone;

  return (
    <Card className={`${styles.card} ${open ? styles.open : ''}`}>
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={detailsId} onClick={onToggle}>
        <span className={styles.top}>
          <ServiceIcon name={b.service_icon} className={styles.icon} />
          <span className={styles.what}>
            <span className={`${styles.service} ${styles.block}`}>{serviceText(b, lang)}</span>
            <span className={`${styles.muted} ${styles.block}`}>{formatDayMonth(lang, endedDay(b))}</span>
          </span>
          <span className={styles.side}>
            {b.status === 'done' ? (
              b.cost !== null && <span className={`mono ${styles.amount}`}>{formatMoney(lang, b.cost)}</span>
            ) : (
              <StatusBadge status={b.status} />
            )}
            <ChevronDown size={18} className={styles.chevron} aria-hidden="true" />
          </span>
        </span>
        <span className={styles.carBlock}>
          <span className={styles.carRow}>
            <span className={styles.car}>{car || t('sb.card.noCar')}</span>
            {plate && <span className={`mono ${styles.plate}`}>{plate}</span>}
          </span>
          <span className={`${styles.muted} ${styles.block}`}>
            {b.client_name || t('sb.card.deletedClient')}
            {b.odometer !== null && <span className={`mono ${styles.nowrap}`}> · {formatKm(lang, b.odometer)}</span>}
          </span>
          {b.work && <span className={`${styles.work} ${styles.block}`}>{b.work}</span>}
        </span>
      </button>

      {open && (
        <div id={detailsId} className={styles.details}>
          <Outcome item={b} />
          {b.quote && <HistoryQuote quote={b.quote} />}
          {b.note && (
            <dl className={styles.facts}>
              <div>
                <dt>{t('hist.card.clientNote')}</dt>
                <dd className={styles.note}>{b.note}</dd>
              </div>
            </dl>
          )}
          <p className={`mono ${styles.muted}`}>
            {t('hist.card.booking', { ref: b.ref, when: `${formatDayMonth(lang, b.date)}, ${b.slot}` })}
          </p>
          <div className={styles.actions}>
            {phone && (
              <a
                className={`mono ${styles.phone}`}
                href={`tel:${normalizePhone(phone) ?? phone.replace(/[^\d+]/g, '')}`}
                aria-label={t('sb.card.call', { name: b.client_name ?? '', phone: formatPhone(phone) })}
              >
                <Phone size={15} aria-hidden="true" />
                {formatPhone(phone)}
              </a>
            )}
            {b.has_client && <MessageLink side="shop" bookingId={b.id} />}
          </div>
        </div>
      )}
    </Card>
  );
}

/** How a job that did not finish ended, in one line. */
function Outcome({ item: b }: { item: ShopHistoryItem }) {
  const { t, lang } = useI18n();
  switch (b.status) {
    case 'quote_refused': {
      const fee = b.cost ?? b.quote?.inspection_fee ?? 0;
      return <p className={styles.muted}>{fee > 0 ? t('hist.card.fee', { fee: formatMoney(lang, fee) }) : t('hist.card.noFee')}</p>;
    }
    case 'expired':
      return <p className={styles.muted}>{t('hist.card.expired')}</p>;
    case 'no_show':
      return <p className={styles.muted}>{t('hist.card.noShow')}</p>;
    case 'cancelled':
      return (
        <p className={styles.muted}>
          {b.cancelled_by && t(`hist.card.cancelled.${b.cancelled_by}`)}
          {b.cancel_reason && <> {t('hist.card.reason', { reason: b.cancel_reason })}</>}
        </p>
      );
    default:
      return null;
  }
}

/** The filtered list as it prints: dark on white, with borders (P17b). */
function PrintTable({ items }: { items: ShopHistoryItem[] }) {
  const { t, lang } = useI18n();
  return (
    <table className={`${styles.printTable} print-only`}>
      <thead>
        <tr>
          <th>{t('hist.col.date')}</th>
          <th>{t('hist.col.car')}</th>
          <th>{t('hist.col.client')}</th>
          <th>{t('hist.col.service')}</th>
          <th>{t('hist.col.odometer')}</th>
          <th>{t('hist.col.work')}</th>
          <th>{t('hist.col.amount')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((b) => (
          <tr key={b.id}>
            <td className="mono">{formatDayMonth(lang, endedDay(b))}</td>
            <td>
              {carText(b)}
              {b.car_snapshot.plate && <div className="mono">{b.car_snapshot.plate}</div>}
            </td>
            <td>{b.client_name}</td>
            <td>
              {serviceText(b, lang)}
              {b.status !== 'done' && <div>{t(`status.${b.status}`)}</div>}
            </td>
            <td className="mono">{b.odometer !== null ? formatKm(lang, b.odometer) : ''}</td>
            <td>{b.work}</td>
            <td className="mono">{b.cost !== null ? formatMoney(lang, b.cost) : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The filtered list as a CSV file for the accountant (P16b), in the interface's language. */
function downloadCsv(items: readonly ShopHistoryItem[], lang: Lang, t: I18nValue['t'], today: string) {
  const { separator, decimal } = csvFormat(lang);
  const header = (
    ['date', 'ref', 'status', 'plate', 'car', 'client', 'service', 'odometer', 'work', 'amount'] as const
  ).map((c) => t(`hist.col.${c}`));
  const rows = items.map((b) => [
    endedDay(b),
    b.ref,
    t(`status.${b.status}`),
    b.car_snapshot.plate ?? '',
    carText(b),
    b.client_name ?? '',
    serviceText(b, lang),
    b.odometer !== null ? String(b.odometer) : '',
    b.work ?? '',
    csvAmount(b.cost, decimal),
  ]);
  const blob = new Blob([toCsv([header, ...rows], separator)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${t('hist.csv.file')}-${today}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
