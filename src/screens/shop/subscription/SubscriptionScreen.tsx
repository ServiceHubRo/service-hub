import { Check, Crown, ExternalLink, Lock, ReceiptText } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { Banner } from '../../../components/Banner';
import { BackLink } from '../../../components/BackLink';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { rpcErrorMessage } from '../../../data/rpc';
import {
  getSubscription,
  openBillingPortal,
  PaymentError,
  startCheckout,
  subscribeSubscription,
  type Invoice,
  type SubscriptionData,
} from '../../../data/subscription';
import { useI18n } from '../../../i18n/context';
import { formatDate, formatDayMonth, formatMoney } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import { plural } from '../../../i18n/translate';
import { monthlyTotal, STATE_TONE, subscriptionView, type SubscriptionView } from '../../../lib/subscription';
import { useLoad } from '../../../lib/useLoad';
import { useNow } from '../../../lib/useNow';
import { SETTINGS_LINKS } from '../settings/paths';
import { ACCOUNT_PATH } from '../paths';
import styles from './subscription.module.css';

/**
 * Abonament (FR §4.7, P12, P12b): the owner's tile in Cont. Where the subscription stands (free
 * days left, next payment, a failed payment, inactive), the one plan, "Activează" (Stripe
 * Checkout) or "Gestionează" (Stripe's portal: card, receipts, cancelling), and the payments with
 * their receipts. The status changes only through Stripe's webhook; the screen follows it live,
 * so coming back from a payment shows it without a reload.
 */
export function SubscriptionScreen() {
  const { t, lang } = useI18n();
  const load = useCallback(() => getSubscription(), []);
  const { state, reload, setData } = useLoad(load);
  const [params] = useSearchParams();
  const returned = params.get('plata');
  const now = useNow();

  // Quiet re-read on every change (a newer read always wins).
  const generation = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++generation.current;
    getSubscription().then(
      (data) => {
        if (mine === generation.current) setData(data);
      },
      () => {},
    );
  }, [setData]);

  const shopId = state.status === 'ready' ? (state.data?.shopId ?? null) : null;
  useEffect(() => (shopId ? subscribeSubscription(shopId, refresh) : undefined), [shopId, refresh]);

  let body;
  if (state.status === 'loading') body = <SkeletonList />;
  else if (state.status === 'error') body = <LoadError message={t('sub.loadError')} onRetry={reload} />;
  else if (!state.data) body = <EmptyState icon={Lock} title={t('sub.ownerOnly')} body={t('sub.ownerOnlyBody')} />;
  else {
    const data = state.data;
    const view = subscriptionView(data.subscription, now);
    body = (
      <>
        {returned && <ReturnBanner returned={returned} view={view} />}
        <StatusCard data={data} view={view} />
        <PlanCard data={data} view={view} />
        <h2 className={styles.section}>{t('sub.invoices')}</h2>
        {data.invoices.length === 0 ? (
          <EmptyState icon={ReceiptText} title={t('sub.invoices.empty')} body={t('sub.invoices.emptyBody')} />
        ) : (
          <ul className={styles.invoices}>
            {data.invoices.map((inv) => (
              <li key={inv.id}>
                <InvoiceRow invoice={inv} />
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <div className={styles.page}>
      <BackLink to={ACCOUNT_PATH} label={t('nav.account')} />
      <h1>{t('sub.title')}</h1>
      {body}
      <p className={styles.note} lang={lang}>
        <Lock size={14} aria-hidden="true" /> {t('sub.stripeNote')}
      </p>
    </div>
  );
}

/** Back from Stripe: confirming (until the webhook's change arrives), done, or not paid. */
function ReturnBanner({ returned, view }: { returned: string; view: SubscriptionView }) {
  const { t } = useI18n();
  if (returned === 'anulata') return <Banner tone="info">{t('sub.return.cancelled')}</Banner>;
  if (returned !== 'ok') return null;
  if (view.canCheckout) return <Banner tone="info">{t('sub.return.ok')}</Banner>;
  if (view.state === 'trial_card') return <Banner tone="info">{t('sub.return.cardSaved')}</Banner>;
  // A later change (a failed payment) has its own text in the status card.
  return view.state === 'active' ? <Banner tone="info">{t('sub.return.done')}</Banner> : null;
}

function StatusCard({ data, view }: { data: SubscriptionData; view: SubscriptionView }) {
  const { t, lang } = useI18n();
  const sub = data.subscription;
  const price = formatMoney(lang, monthlyTotal(sub));
  const date = (iso: string | null) => (iso ? formatDayMonth(lang, new Date(iso)) : '');

  let text: string;
  switch (view.state) {
    case 'trial':
      text = view.daysLeft === 0 ? t('sub.trial.today') : t('sub.trial.until', { date: date(sub.trial_ends_at) });
      break;
    case 'trial_card':
      text = t('sub.trialCard', { price, date: date(sub.trial_ends_at) });
      break;
    case 'active':
      text = sub.current_period_end ? t('sub.active', { price, date: date(sub.current_period_end) }) : t('sub.activeNoDate');
      break;
    case 'ending':
      text = t('sub.ending', { date: date(sub.current_period_end) });
      break;
    case 'past_due':
      text = sub.next_payment_attempt ? t('sub.pastDue', { date: date(sub.next_payment_attempt) }) : t('sub.pastDueNoDate');
      break;
    case 'cancelled':
      text = sub.ended_reason === 'admin' ? t('sub.inactiveAdmin') : t('sub.cancelled');
      break;
    default:
      text =
        sub.ended_reason === 'payment_failed'
          ? t('sub.inactivePayment')
          : sub.ended_reason === 'admin'
            ? t('sub.inactiveAdmin')
            : t('sub.inactive');
  }

  const inTrial = view.daysLeft !== null && view.trialDays !== null;
  return (
    <Card className={view.goodStanding ? styles.status : `${styles.status} ${styles.statusBad}`}>
      <div className={styles.statusHead}>
        <span className={styles.statusLabel}>{t('sub.status')}</span>
        <span className={`${styles.pill} ${styles[TONE_CLASS[STATE_TONE[view.state]]]}`}>{t(`sub.state.${view.state}`)}</span>
      </div>
      {inTrial && view.daysLeft! > 0 && (
        <>
          <p className={styles.trial}>
            <Crown size={20} className={styles.crown} aria-hidden="true" />
            <span>{t('sub.trial.left', { left: plural(lang, 'unit.trialLeft', view.daysLeft!), total: view.trialDays! })}</span>
          </p>
          <div
            className={styles.meter}
            role="meter"
            aria-valuemin={0}
            aria-valuemax={view.trialDays!}
            aria-valuenow={view.daysLeft!}
            aria-label={plural(lang, 'unit.trialLeft', view.daysLeft!)}
          >
            <span style={{ width: `${Math.min(100, Math.round((view.daysLeft! / view.trialDays!) * 100))}%` }} />
          </div>
        </>
      )}
      <p className={view.goodStanding ? styles.statusText : styles.statusTextBad}>{text}</p>
      {!view.goodStanding && <p className={styles.muted}>{t('sub.keepData')}</p>}
    </Card>
  );
}

/**
 * The price per colleague (paid staff seats): "100 lei + 2 colegi × 20 lei" when there are
 * colleagues with an account, else what one would add. Nothing is paid in the free period.
 */
function SeatsLine({ sub }: { sub: SubscriptionData['subscription'] }) {
  const { t, lang } = useI18n();
  const seat = formatMoney(lang, sub.seat_price_ron);
  if (!(sub.seat_price_ron > 0)) return null;
  return (
    <p className={styles.seats}>
      {sub.seats > 0
        ? t('sub.seats.breakdown', {
            base: formatMoney(lang, sub.price_ron),
            colleagues: plural(lang, 'unit.colleagues', sub.seats),
            seat,
          })
        : t('sub.seats.none', { seat })}
    </p>
  );
}

const TONE_CLASS = { amber: 'toneAmber', green: 'toneGreen', red: 'toneRed', muted: 'toneMuted' } as const;

const FEATURES: MessageKey[] = ['sub.feature.all', 'sub.feature.capacity', 'sub.feature.ranking', 'sub.feature.cancel'];

function PlanCard({ data, view }: { data: SubscriptionData; view: SubscriptionView }) {
  const { t, lang } = useI18n();
  const go = (url: string) => window.location.assign(url);
  const errorMessage = (e: unknown) =>
    e instanceof PaymentError ? t(`sub.error.${e.problem}` as MessageKey) : rpcErrorMessage(lang, e);
  // Inside the free period (2+ days left) Stripe only saves the card; else it charges now.
  const savesCardOnly = view.state === 'trial' && (view.daysLeft ?? 0) >= 3;

  return (
    <Card className={styles.plan}>
      <p className={styles.planLabel}>{t('sub.plan')}</p>
      <p className={styles.price}>
        <span className={styles.amount}>{formatMoney(lang, monthlyTotal(data.subscription))}</span>
        <span className={styles.per}>{t('sub.perMonth')}</span>
      </p>
      <SeatsLine sub={data.subscription} />
      <ul className={styles.features}>
        {FEATURES.map((key) => (
          <li key={key}>
            <Check size={18} className={styles.check} aria-hidden="true" />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>

      {view.canCheckout && !data.billingComplete && (
        <div className={styles.billing}>
          <p>{t('sub.billingNeeded')}</p>
          <Link to={SETTINGS_LINKS.billing} className={buttonClass('primary', true)}>
            {t('sub.billingOpen')}
          </Link>
        </div>
      )}
      {view.canCheckout && data.billingComplete && (
        <div className={styles.action}>
          <ActionButton onAction={async (requestId) => go(await startCheckout(requestId))} errorMessage={errorMessage}>
            {t(view.goodStanding ? 'sub.activate' : 'sub.pay')}
          </ActionButton>
          <p className={styles.muted}>{t(savesCardOnly ? 'sub.activate.trialHint' : 'sub.activate.nowHint')}</p>
        </div>
      )}
      {view.canManage && (
        <div className={styles.action}>
          <ActionButton
            variant={view.canCheckout ? 'ghost' : view.state === 'past_due' ? 'primary' : 'secondary'}
            onAction={async () => go(await openBillingPortal())}
            errorMessage={errorMessage}
          >
            {t('sub.manage')}
          </ActionButton>
          <p className={styles.muted}>{t('sub.manageHint')}</p>
        </div>
      )}
    </Card>
  );
}

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const { t, lang } = useI18n();
  const day = invoice.issued_at ? formatDate(lang, new Date(invoice.issued_at)) : '';
  return (
    <Card className={styles.invoice}>
      <div className={styles.invoiceMain}>
        <span className={styles.invoiceDate}>{day}</span>
        {invoice.period_end && (
          <span className={styles.muted}>{t('sub.invoice.until', { date: formatDayMonth(lang, new Date(invoice.period_end)) })}</span>
        )}
        {!invoice.pdf_url && <span className={styles.muted}>{t('sub.invoice.pending')}</span>}
      </div>
      <div className={styles.invoiceSide}>
        <span className={styles.invoiceAmount}>{formatMoney(lang, invoice.amount)}</span>
        <span className={styles.links}>
          {invoice.pdf_url && (
            <a href={invoice.pdf_url} target="_blank" rel="noopener noreferrer" aria-label={t('sub.invoice.pdfLabel', { date: day })}>
              {t('sub.invoice.pdf')} <ExternalLink size={13} aria-hidden="true" />
            </a>
          )}
          {invoice.receipt_url && (
            <a
              href={invoice.receipt_url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('sub.invoice.receiptLabel', { date: day })}
            >
              {t('sub.invoice.receipt')} <ExternalLink size={13} aria-hidden="true" />
            </a>
          )}
        </span>
      </div>
    </Card>
  );
}
