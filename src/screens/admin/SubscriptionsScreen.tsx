import { CreditCard, Receipt, SearchX } from 'lucide-react';
import { useDeferredValue, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ChoiceFilters } from '../../components/Filters';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { buttonClass } from '../../components/buttonClass';
import { DetailFacts, DetailPane, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { ViewSelect } from '../../components/ViewSelect';
import { fetchSubscriptions, type AdminInvoiceRow, type AdminSubscriptionRow } from '../../data/adminTools';
import { adminZoneBack } from '../../app/adminZones';
import { useI18n } from '../../i18n/context';
import { formatMoney } from '../../i18n/format';
import type { Lang } from '../../i18n/translate';
import type { MessageKey } from '../../i18n/ro';
import { filterSubscriptions, isSubscriptionFilter, SUBSCRIPTION_FILTERS } from '../../lib/adminTools';
import { useListDetail } from '../../lib/useListDetail';
import { ExportButton } from './ExportButton';
import { Money, Pill, SubscriptionPill } from './parts';
import { ADMIN_SUBSCRIPTIONS_PATH, adminShopPath } from './paths';
import { useLiveData } from './useLiveData';
import { useUrlParams } from './useUrlParams';
import { day } from './format';
import styles from './admin.module.css';
import { PageHeader } from '../../components/PageHeader';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_SUBSCRIPTIONS_PATH);

const LIVE = [{ table: 'subscriptions' }, { table: 'invoices' }];

type Tab = 'abonamente' | 'plati';

const INVOICE_TONE = { paid: 'green', issued: 'green', failed: 'red', void: 'grey' } as const;

/** The next billing line of a subscription („Gratuit până pe …”, „Următoarea plată …”). */
function nextLine(t: ReturnType<typeof useI18n>['t'], lang: Lang, r: AdminSubscriptionRow): string | null {
  if (r.next_billing) {
    return t(r.status === 'trial' ? 'admin.subs.trialUntil' : r.status === 'past_due' ? 'admin.subs.retryOn' : 'admin.subs.nextOn', {
      date: day(lang, r.next_billing),
    });
  }
  return r.cancel_at_period_end && r.current_period_end ? t('admin.subs.endsOn', { date: day(lang, r.current_period_end) }) : null;
}

function SubscriptionDetail({ r }: { r: AdminSubscriptionRow }) {
  const { t, lang } = useI18n();
  const next = nextLine(t, lang, r);
  return (
    <DetailPane
      id={r.shop_id}
      icon={<CreditCard size={20} />}
      title={r.shop_name}
      detail={[r.display_id, r.city].filter(Boolean).join(' · ')}
      status={<SubscriptionPill status={r.status} />}
      actions={
        <Link className={buttonClass('secondary')} to={adminShopPath(r.shop_id)}>
          {t('admin.shops.open')}
        </Link>
      }
    >
      <DetailFacts
        items={[
          {
            label: t('admin.subs.price'),
            value: (
              <span>
                <Money amount={r.monthly_ron} />
                {t('admin.subs.perMonth')}
              </span>
            ),
          },
          ...(r.billing_months > 1 ? [{ label: t('admin.subs.periodLabel'), value: t('admin.subs.period', { n: r.billing_months, discount: r.period_discount }) }] : []),
          ...(r.seats > 0 ? [{ label: t('admin.subs.seatsLabel'), value: t('admin.subs.seats', { n: r.seats }) }] : []),
          { label: t('admin.subs.paidLabel'), value: r.paid_count > 0 ? `${r.paid_count} · ${formatMoney(lang, r.paid_total)}` : '0' },
          ...(r.stripe_customer_id || r.stripe_subscription_id
            ? [
                {
                  label: 'Stripe',
                  value: (
                    <span className="mono">
                      {[r.stripe_customer_id, r.stripe_subscription_id].filter(Boolean).join(' · ')}
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />
      {next && <p className={styles.muted}>{next}</p>}
    </DetailPane>
  );
}

function InvoiceDetail({ i }: { i: AdminInvoiceRow }) {
  const { t, lang } = useI18n();
  return (
    <DetailPane
      id={i.id}
      icon={<Receipt size={20} />}
      title={i.shop_name}
      detail={[formatMoney(lang, i.amount), day(lang, i.issued_at)].join(' · ')}
      status={<Pill tone={INVOICE_TONE[i.status]}>{t(`admin.invoice.${i.status}` as MessageKey)}</Pill>}
      actions={
        <>
          {i.receipt_url && (
            <a className={buttonClass('secondary')} href={i.receipt_url} target="_blank" rel="noopener noreferrer">
              {t('admin.subs.receipt')}
            </a>
          )}
          {i.pdf_url && (
            <a className={buttonClass('secondary')} href={i.pdf_url} target="_blank" rel="noopener noreferrer">
              {t('admin.subs.invoice')}
            </a>
          )}
          <Link className={buttonClass('secondary')} to={adminShopPath(i.shop_id)}>
            {t('admin.shops.open')}
          </Link>
        </>
      }
    >
      <DetailFacts
        items={[
          ...(i.series && i.number ? [{ label: t('admin.subs.invoice'), value: <span className="mono">{`${i.series} ${i.number}`}</span> }] : []),
          ...(i.provider_ref ? [{ label: 'Stripe', value: <span className="mono">{i.provider_ref}</span> }] : []),
        ]}
      />
    </DetailPane>
  );
}

/**
 * Abonamente și facturi (FR §5.6, P21): every subscription with its status, price, next billing
 * date and Stripe references; every payment with Stripe's receipt (the fiscal invoice arrives with
 * T14b). A row opens the shop, where the changes by hand are (free period, status, price).
 * Search, status chips and the tab live in the address. Live.
 */
export function SubscriptionsScreen() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const { state, reload } = useLiveData(fetchSubscriptions, LIVE, 'admin-subscriptions');
  const { params, setParam, text, setText } = useUrlParams();
  const tab: Tab = params.get('tab') === 'plati' ? 'plati' : 'abonamente';
  const filterParam = params.get('stare');
  const filter = isSubscriptionFilter(filterParam) ? filterParam : 'all';
  const query = useDeferredValue(text);
  const data = state.status === 'ready' ? state.data : null;
  const shown = useMemo(() => (data ? filterSubscriptions(data.subscriptions, query, filter) : []), [data, query, filter]);

  // Page template A (docs/MODEL_DE_FOLOSIRE.md P8): one row per subscription (or per payment), the chosen
  // one beside the list from 1024 px (in its place below); the shop's file is „Deschide fișa”.
  const ids = tab === 'abonamente' ? shown.map((r) => r.shop_id) : (data?.invoices ?? []).map((i) => i.id);
  const { wide, selectedId, open, select } = useListDetail(ids, 'abonament');
  const chosenSub = tab === 'abonamente' ? shown.find((r) => r.shop_id === selectedId) ?? null : null;
  const chosenInvoice = tab === 'plati' ? data?.invoices.find((i) => i.id === selectedId) ?? null : null;

  const header = (
    <>
      <PageHeader back={{ to: ZONE_BACK.to, label: t(ZONE_BACK.label) }} title={t('admin.subs.title')} />
      {data && (
        <ViewSelect<Tab>
          value={tab}
          onChange={(k) => setParam({ tab: k === 'plati' ? 'plati' : null })}
          items={[
            { key: 'abonamente', label: t('admin.subs.tab.subscriptions'), count: data.subscriptions.length },
            { key: 'plati', label: t('admin.subs.tab.payments'), count: data.invoices.length },
          ]}
        />
      )}
      {data && tab === 'abonamente' && (
        <div className={styles.controls}>
          <SearchField
            id="admin-subs-q"
            label={t('admin.subs.search')}
            placeholder={t('admin.subs.search')}
            value={text}
            onChange={setText}
            onClear={() => {
              setText('');
              setParam({ q: null });
            }}
            clearLabel={t('admin.search.clear')}
          />
          <ChoiceFilters
            groups={[
              {
                key: 'stare',
                title: t('admin.filter.state'),
                options: SUBSCRIPTION_FILTERS.map((f) => ({
                  value: f,
                  label: f === 'all' ? t('admin.shopFilter.all') : t(`admin.subStatus.${f}`),
                })),
                value: filter,
                defaultValue: 'all',
                onChange: (v) => setParam({ stare: v === 'all' ? null : v }),
              },
            ]}
            end={
              <div className={styles.toolbar}>
                {/* No count here (Eduard, 14 Nov 2026): it already stands on „Afișează: Abonamente (n)”. */}
                <ExportButton<AdminSubscriptionRow>
                  kind="subscriptions"
                  filters={{ q: query || undefined, status: filter === 'all' ? undefined : filter }}
                  ids={shown.map((r) => r.shop_id)}
                  narrow={(rows) => filterSubscriptions(rows, query, filter)}
                />
              </div>
            }
          />
        </div>
      )}
    </>
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('admin.loadError')} onRetry={reload} />;
  else if (data && tab === 'abonamente') {
    if (data.subscriptions.length === 0) list = <EmptyState icon={CreditCard} title={t('admin.subs.empty')} />;
    else if (shown.length === 0)
      list = (
        <EmptyState
          icon={SearchX}
          title={t('admin.noResults')}
          action={
            <Button
              variant="primary"
              onClick={() => {
                setText('');
                setParam({ q: null, stare: null });
              }}
            >
              {t('admin.clearFilters')}
            </Button>
          }
        />
      );
    else
      list = (
        <ListRows label={t('admin.subs.tab.subscriptions')}>
          {shown.map((r) => (
            <ListRow
              key={r.shop_id}
              icon={<CreditCard size={20} />}
              title={r.shop_name}
              detail={[r.display_id, r.city, `${formatMoney(lang, r.monthly_ron)}${t('admin.subs.perMonth')}`].filter(Boolean).join(' · ')}
              status={<SubscriptionPill status={r.status} />}
              selected={wide && r.shop_id === selectedId}
              onSelect={() => select(r.shop_id)}
            />
          ))}
        </ListRows>
      );
  } else if (data) {
    list =
      data.invoices.length === 0 ? (
        <EmptyState icon={Receipt} title={t('admin.subs.noPayments')} body={t('admin.subs.noPaymentsBody')} />
      ) : (
        <ListRows label={t('admin.subs.tab.payments')}>
          {data.invoices.map((i) => (
            <ListRow
              key={i.id}
              icon={<Receipt size={20} />}
              title={i.shop_name}
              detail={[formatMoney(lang, i.amount), day(lang, i.issued_at), i.series && i.number ? `${i.series} ${i.number}` : null].filter(Boolean).join(' · ')}
              status={<Pill tone={INVOICE_TONE[i.status]}>{t(`admin.invoice.${i.status}` as MessageKey)}</Pill>}
              selected={wide && i.id === selectedId}
              onSelect={() => select(i.id)}
            />
          ))}
        </ListRows>
      );
  }

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={`${pathname}${tab === 'plati' ? '?tab=plati' : ''}`}
        backLabel={t('admin.subs.title')}
        header={header}
        list={list}
        detail={chosenSub ? <SubscriptionDetail key={chosenSub.shop_id} r={chosenSub} /> : chosenInvoice ? <InvoiceDetail key={chosenInvoice.id} i={chosenInvoice} /> : null}
      />
    </div>
  );
}
