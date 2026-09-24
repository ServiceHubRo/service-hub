import { Phone, Star } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { Button } from '../../../components/Button';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { InlinePanel } from '../../../components/InlinePanel';
import { ServiceIcon } from '../../../components/ServiceIcon';
import { StatusBadge } from '../../../components/StatusBadge';
import { quoteOf, type ClientBooking } from '../../../data/bookings';
import { cancelBooking, canRetryRpc, rpcErrorMessage, toRpcError, type Booking, type RpcErrorCode } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { daysFromToday, formatDate, formatKm, formatMoney, formatTime, ymdInBucharest } from '../../../i18n/format';
import { cancelState, reviewState, type Quote } from '../../../lib/clientBookings';
import { formatPhone, normalizePhone } from '../../../lib/validators';
import { bookingPath } from '../paths';
import { serviceName } from '../shop/serviceGroups';
import { QuoteDecision } from './QuoteDecision';
import { ReviewForm } from './ReviewForm';
import styles from './bookings.module.css';

/** Answers meaning the card shows an outdated booking or quote: read the list again. */
const STALE: ReadonlySet<RpcErrorCode> = new Set(['wrong_status', 'booking_not_found', 'quote_changed', 'quote_expired']);

const PICKUP_DAYS = 2;

export interface ClientBookingCardProps {
  booking: ClientBooking;
  reviewWindowDays: number;
  now: Date;
  /** An action went through: the booking as the database returned it. */
  onDone: (row: Booking) => void;
  /** A review was sent. */
  onReviewed: (id: string, review: { id: string; rating: number }) => void;
  /** The booking changed under this card: read the list again. */
  onStale: () => void;
}

/**
 * One booking in the client's Programări (FR §3.5, P10b, P15, P15c): service, shop, day and time,
 * car and status; what the status means now (the quote to decide on, the job in progress, the
 * finished job with odometer, work and amount); and what the client can do: cancel while allowed,
 * review a finished job once, book again. Every write goes through a database function.
 */
export function ClientBookingCard({ booking: b, reviewWindowDays, now, onDone, onReviewed, onStale }: ClientBookingCardProps) {
  const { t, lang } = useI18n();
  const [panel, setPanel] = useState<'cancel' | 'review' | null>(null);
  const quote = quoteOf(b);
  const car = [[b.car_snapshot.make, b.car_snapshot.model].filter(Boolean).join(' '), b.car_snapshot.plate].filter(Boolean).join(' · ');
  const cancel = cancelState(b, b.shop?.cancel_deadline_hours ?? 0, now);
  const review = reviewState(b, b.review !== null, reviewWindowDays, now);
  const shopName = b.shop?.name ?? '';

  /** Runs one RPC; an outdated card makes the list reload. */
  async function act(run: () => Promise<Booking>): Promise<void> {
    try {
      const row = await run();
      setPanel(null);
      onDone(row);
    } catch (e) {
      if (STALE.has(toRpcError(e).code)) onStale();
      throw e;
    }
  }

  const bookAgain = b.status === 'done' && b.shop;
  const hasActions = panel === null && (cancel !== 'not_allowed' || review === 'open' || review === 'sent' || bookAgain);

  return (
    <Card highlight={b.status === 'quote_sent'} className={styles.card}>
      <div className={styles.top}>
        <ServiceIcon name={b.service?.icon} className={styles.icon} />
        <div className={styles.what}>
          <p className={styles.service}>{b.service ? serviceName(b.service, lang) : b.service_id}</p>
          {b.shop && (
            <p className={styles.muted}>
              {b.shop.name} · {b.shop.city}
            </p>
          )}
        </div>
        <StatusBadge status={b.status} />
      </div>
      <p className={styles.when}>
        <span className="mono">
          {formatDate(lang, b.date)}, {b.slot.slice(0, 5)}
        </span>
        <span className={`mono ${styles.ref}`}> · {b.ref}</span>
        {b.status === 'done' && b.odometer !== null && <span className="mono"> · {formatKm(lang, b.odometer)}</span>}
        {car && <span className={styles.muted}> · {car}</span>}
      </p>
      {b.note && <p className={styles.note}>{b.note}</p>}

      <StatusDetail booking={b} quote={quote} now={now} />
      {b.status === 'quote_sent' && quote && (
        // A replaced quote starts with every line ticked again.
        <QuoteDecision key={quote.id} bookingId={b.id} quote={quote} act={act} />
      )}

      {hasActions && (
        <div className={styles.actions}>
          {cancel === 'allowed' && (
            <Button variant="danger" onClick={() => setPanel('cancel')}>
              {t('cb.cancel')}
            </Button>
          )}
          {review === 'open' && (
            <Button variant="primary" onClick={() => setPanel('review')}>
              {t('cb.review.leave')}
            </Button>
          )}
          {bookAgain && (
            <Link to={`${bookingPath(b.shop_id)}?pas=2&serviciu=${encodeURIComponent(b.service_id)}`} className={buttonClass('secondary')}>
              {t('cb.bookAgain')}
            </Link>
          )}
          {review === 'sent' && (
            <p className={styles.reviewSent}>
              <Star size={15} aria-hidden="true" className={styles.starFilled} />
              {t('cb.review.sent')}
            </p>
          )}
        </div>
      )}
      {panel === null && cancel === 'deadline_passed' && (
        <div className={styles.contact}>
          <p className={styles.muted}>{t('cb.cancel.contact')}</p>
          {b.shop?.phone && (
            <a
              className={`mono ${styles.phone}`}
              href={`tel:${normalizePhone(b.shop.phone) ?? b.shop.phone.replace(/[^\d+]/g, '')}`}
              aria-label={t('cb.cancel.call', { shop: shopName, phone: formatPhone(b.shop.phone) })}
            >
              <Phone size={15} aria-hidden="true" />
              {formatPhone(b.shop.phone)}
            </a>
          )}
        </div>
      )}

      {panel === 'cancel' && (
        <InlinePanel title={t('cb.cancel.title')}>
          <p className={styles.panelBody}>{t('cb.cancel.body')}</p>
          <div className={styles.buttons}>
            <ActionButton
              variant="danger"
              block={false}
              onAction={(rid) => act(() => cancelBooking(b.id, rid))}
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              canRetry={canRetryRpc}
            >
              {t('cb.cancel.submit')}
            </ActionButton>
            <Button variant="ghost" onClick={() => setPanel(null)}>
              {t('cb.cancel.keep')}
            </Button>
          </div>
        </InlinePanel>
      )}
      {panel === 'review' && (
        <ReviewForm
          bookingId={b.id}
          shopName={shopName}
          onSent={(r) => {
            setPanel(null);
            onReviewed(b.id, { id: r.id, rating: r.rating });
          }}
          onStale={onStale}
          onClose={() => setPanel(null)}
        />
      )}
    </Card>
  );
}

/** "Gata de ridicare" while the job is fresh (finished today or in the last 2 days), then "Lucrare finalizată". */
function pickupState(doneAt: string | null, now: Date): boolean {
  return doneAt !== null && daysFromToday(ymdInBucharest(new Date(doneAt)), now) >= -PICKUP_DAYS;
}

/** The accepted quote after the decision: refused lines struck through (and said in words). */
function DecidedLines({ quote }: { quote: Quote }) {
  const { t, lang } = useI18n();
  return (
    <div className={styles.quote}>
      <ul className={styles.quoteLines}>
        {quote.items.map((item) => {
          const refused = item.approved === false;
          return (
            <li key={item.id} className={`${styles.quoteLine} ${refused ? styles.refused : ''}`}>
              <span className={styles.lineName}>
                {item.name}
                {refused && <span className="visually-hidden">, {t('cb.quote.refusedLine')}</span>}
              </span>
              <span className="mono">{formatMoney(lang, item.price)}</span>
            </li>
          );
        })}
      </ul>
      <p className={styles.quoteTotal}>
        <span>{t('cb.quote.totalApproved')}</span>
        <span className="mono">{formatMoney(lang, quote.total_approved ?? quote.total_sent)}</span>
      </p>
    </div>
  );
}

/** What the status means right now (P15 "Status display for the client"). */
function StatusDetail({ booking: b, quote, now }: { booking: ClientBooking; quote: Quote | null; now: Date }) {
  const { t, lang } = useI18n();
  /** `09:20`, or `Lun 13 oct, 09:20` when it was not today. */
  const at = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    const time = formatTime(lang, d);
    return daysFromToday(ymdInBucharest(d), now) === 0 ? time : `${formatDate(lang, d)}, ${time}`;
  };
  const reason = (text: string | null) => (text ? <p className={styles.reason}>{t('cb.reason', { reason: text })}</p> : null);

  switch (b.status) {
    case 'pending':
      return <p className={styles.muted}>{t('cb.pending')}</p>;
    case 'in_inspection':
      return (
        <div className={styles.live}>
          <span className={styles.dot} aria-hidden="true" />
          <div>
            <p className={styles.liveTitle}>{t('cb.inspection')}</p>
            <p className={styles.muted}>{t('cb.inspectionBody')}</p>
          </div>
        </div>
      );
    case 'approved': {
      if (!quote) return null;
      const accepted = quote.items.filter((i) => i.approved).length;
      const amount = formatMoney(lang, quote.total_approved ?? quote.total_sent);
      return (
        <>
          <DecidedLines quote={quote} />
          <p className={styles.ok}>
            {quote.status === 'partially_accepted'
              ? t('cb.approvedPartial', { n: accepted, total: quote.items.length, amount })
              : t('cb.approved', { amount })}
          </p>
        </>
      );
    }
    case 'in_progress':
      return (
        <>
          <div className={styles.live}>
            <span className={styles.dot} aria-hidden="true" />
            <div>
              <p className={styles.liveTitle}>{t('cb.inProgress')}</p>
              {b.started_at && <p className={`mono ${styles.muted}`}>{t('cb.inProgressSince', { time: at(b.started_at) })}</p>}
            </div>
          </div>
          {quote && <DecidedLines quote={quote} />}
        </>
      );
    case 'done':
      return (
        <div className={styles.doneBox}>
          <p className={styles.doneTitle}>{pickupState(b.done_at, now) ? t('cb.done') : t('cb.doneOld')}</p>
          <dl className={styles.facts}>
            {b.work && (
              <div>
                <dt>{t('cb.done.work')}</dt>
                <dd>{b.work}</dd>
              </div>
            )}
            {b.cost !== null && (
              <div>
                <dt>{t('cb.done.cost')}</dt>
                <dd className="mono">{formatMoney(lang, b.cost)}</dd>
              </div>
            )}
          </dl>
        </div>
      );
    case 'quote_refused': {
      const fee = b.cost ?? quote?.inspection_fee ?? 0;
      return (
        <p className={styles.muted}>
          {fee > 0 ? t('cb.quoteRefused', { fee: formatMoney(lang, fee) }) : t('cb.quoteRefusedNoFee')}
        </p>
      );
    }
    case 'expired':
      return <p className={styles.muted}>{t('cb.expired')}</p>;
    case 'no_show':
      return <p className={styles.muted}>{t('cb.noShow')}</p>;
    case 'declined':
      return (
        <>
          <p className={styles.muted}>{t('cb.declined')}</p>
          {reason(b.decline_reason)}
        </>
      );
    case 'cancelled':
      return (
        <>
          <p className={styles.muted}>
            {b.cancelled_by === 'shop'
              ? t('cb.cancelledShop')
              : b.cancelled_by === 'admin'
                ? t('cb.cancelledAdmin')
                : t('cb.cancelledClient')}
          </p>
          {b.cancelled_by !== 'client' && reason(b.cancel_reason)}
        </>
      );
    default:
      return null;
  }
}
