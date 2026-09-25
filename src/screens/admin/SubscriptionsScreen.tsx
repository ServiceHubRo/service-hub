import { CreditCard, Receipt, SearchX } from 'lucide-react';
import { useDeferredValue, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip, ChipRow } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { SkeletonList } from '../../components/Skeleton';
import { Tabs } from '../../components/Tabs';
import { fetchSubscriptions, type AdminInvoiceRow, type AdminSubscriptionRow } from '../../data/adminTools';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { plural } from '../../i18n/translate';
import { filterSubscriptions, isSubscriptionFilter, SUBSCRIPTION_FILTERS } from '../../lib/adminTools';
import { ExportButton } from './ExportButton';
import { Money, Pill, RowLink, SubscriptionPill } from './parts';
import { ADMIN_ACCOUNT_PATH, adminShopPath } from './paths';
import { useLiveData } from './useLiveData';
import { useUrlParams } from './useUrlParams';
import { day } from './format';
import styles from './admin.module.css';

const LIVE = [{ table: 'subscriptions' }, { table: 'invoices' }];

type Tab = 'abonamente' | 'plati';

const INVOICE_TONE = { paid: 'green', issued: 'green', failed: 'red', void: 'grey' } as const;

function SubscriptionRow({ r }: { r: AdminSubscriptionRow }) {
  const { t, lang } = useI18n();
  const next = r.next_billing
    ? t(r.status === 'trial' ? 'admin.subs.trialUntil' : r.status === 'past_due' ? 'admin.subs.retryOn' : 'admin.subs.nextOn', {
        date: day(lang, r.next_billing),
      })
    : r.cancel_at_period_end && r.current_period_end
      ? t('admin.subs.endsOn', { date: day(lang, r.current_period_end) })
      : null;
  return (
    <RowLink to={adminShopPath(r.shop_id)}>
      <span className={styles.rowTop}>
        <span className={styles.rowTitle}>{r.shop_name}</span>
        <SubscriptionPill status={r.status} />
      </span>
      <span className={styles.rowMeta}>
        <span className={styles.id}>{r.display_id}</span>
        <span>{r.city}</span>
        <span>
          <Money amount={r.price_ron} />
          {t('admin.subs.perMonth')}
        </span>
      </span>
      {next && <span className={styles.rowMeta}>{next}</span>}
      <span className={styles.rowMeta}>
        <span>{t('admin.subs.paid', { n: r.paid_count })}</span>
        {r.paid_count > 0 && <Money amount={r.paid_total} />}
        {r.stripe_customer_id && <span className="mono">{r.stripe_customer_id}</span>}
        {r.stripe_subscription_id && <span className="mono">{r.stripe_subscription_id}</span>}
      </span>
    </RowLink>
  );
}

function InvoiceRow({ i }: { i: AdminInvoiceRow }) {
  const { t, lang } = useI18n();
  return (
    <Card className={styles.stack}>
      <div className={styles.cardHead}>
        <Link className={styles.link} to={adminShopPath(i.shop_id)}>
          {i.shop_name}
        </Link>
        <Pill tone={INVOICE_TONE[i.status]}>{t(`admin.invoice.${i.status}` as MessageKey)}</Pill>
      </div>
      <span className={styles.rowMeta}>
        <Money amount={i.amount} />
        <span>{day(lang, i.issued_at)}</span>
        {i.series && i.number && <span className="mono">{`${i.series} ${i.number}`}</span>}
        {i.provider_ref && <span className="mono">{i.provider_ref}</span>}
      </span>
      {(i.receipt_url || i.pdf_url) && (
        <span className={styles.rowMeta}>
          {i.receipt_url && (
            <a className={styles.link} href={i.receipt_url} target="_blank" rel="noopener noreferrer">
              {t('admin.subs.receipt')}
            </a>
          )}
          {i.pdf_url && (
            <a className={styles.link} href={i.pdf_url} target="_blank" rel="noopener noreferrer">
              {t('admin.subs.invoice')}
            </a>
          )}
        </span>
      )}
    </Card>
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
  const { state, reload } = useLiveData(fetchSubscriptions, LIVE, 'admin-subscriptions');
  const { params, setParam, text, setText } = useUrlParams();
  const tab: Tab = params.get('tab') === 'plati' ? 'plati' : 'abonamente';
  const filterParam = params.get('stare');
  const filter = isSubscriptionFilter(filterParam) ? filterParam : 'all';
  const query = useDeferredValue(text);
  const data = state.status === 'ready' ? state.data : null;
  const shown = useMemo(() => (data ? filterSubscriptions(data.subscriptions, query, filter) : []), [data, query, filter]);

  return (
    <div className={styles.page}>
      <BackLink to={ADMIN_ACCOUNT_PATH} label={t('nav.account')} />
      <div>
        <h1>{t('admin.subs.title')}</h1>
        <p className={styles.sub}>{t('admin.subs.sub')}</p>
      </div>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {data && (
        <>
          <Tabs<Tab>
            label={t('admin.subs.title')}
            value={tab}
            onChange={(k) => setParam({ tab: k === 'plati' ? 'plati' : null })}
            items={[
              { key: 'abonamente', label: t('admin.subs.tab.subscriptions'), count: data.subscriptions.length },
              { key: 'plati', label: t('admin.subs.tab.payments'), count: data.invoices.length },
            ]}
          />
          {tab === 'abonamente' ? (
            <>
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
                <ChipRow label={t('admin.filter.state')}>
                  {SUBSCRIPTION_FILTERS.map((f) => (
                    <Chip key={f} selected={filter === f} onClick={() => setParam({ stare: f === 'all' ? null : f })}>
                      {f === 'all' ? t('admin.shopFilter.all') : t(`admin.subStatus.${f}`)}
                    </Chip>
                  ))}
                </ChipRow>
                <div className={styles.toolbar}>
                  <span className={styles.sub}>{plural(lang, 'unit.subscriptions', shown.length)}</span>
                  <ExportButton<AdminSubscriptionRow>
                    kind="subscriptions"
                    filters={{ q: query || undefined, status: filter === 'all' ? undefined : filter }}
                    narrow={(rows) => filterSubscriptions(rows, query, filter)}
                  />
                </div>
              </div>
              {data.subscriptions.length === 0 ? (
                <EmptyState icon={CreditCard} title={t('admin.subs.empty')} />
              ) : shown.length === 0 ? (
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
              ) : (
                <ul className={styles.list}>
                  {shown.map((r) => (
                    <li key={r.shop_id}>
                      <SubscriptionRow r={r} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : data.invoices.length === 0 ? (
            <EmptyState icon={Receipt} title={t('admin.subs.noPayments')} body={t('admin.subs.noPaymentsBody')} />
          ) : (
            <ul className={styles.list}>
              {data.invoices.map((i) => (
                <li key={i.id}>
                  <InvoiceRow i={i} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
