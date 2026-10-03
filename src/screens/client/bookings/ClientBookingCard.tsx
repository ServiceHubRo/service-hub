import { History, Phone, Star } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { Button } from '../../../components/Button';
import { buttonClass } from '../../../components/buttonClass';
import { CalendarLinks } from '../../../components/CalendarLinks';
import { Card } from '../../../components/Card';
import { OfferNote } from '../../../components/OfferNote';
import { InlinePanel } from '../../../components/InlinePanel';
import { ServiceIcon } from '../../../components/ServiceIcon';
import { StatusBadge } from '../../../components/StatusBadge';
import { quoteOf, type ClientBooking } from '../../../data/bookings';
import {
  cancelBooking,
  canRetryRpc,
  rpcErrorMessage,
  setBookingHistoryShare,
  toRpcError,
  type Booking,
  type RpcErrorCode,
} from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { daysFromToday, formatDate, formatKm, formatMoney, formatTime, ymdInBucharest } from '../../../i18n/format';
import { bookingServicesText } from '../../../lib/bookingServices';
import { cancelState, reviewState, type Quote } from '../../../lib/clientBookings';
import { isActiveStatus } from '../../../lib/status';
import { formatPhone, normalizePhone } from '../../../lib/validators';
import { MessageLink } from '../../messages/MessageLink';
import { bookingCarHistoryPath, bookingPath, SEARCH_PATH, type VehicleHistoryLinkState } from '../paths';
import { QuoteDecision } from './QuoteDecision';
import { ReviewForm } from './ReviewForm';
import styles from './bookings.module.css';

/** Answers meaning the card shows an outdated booking or quote: read the list again. */
const STALE: ReadonlySet<RpcErrorCode> = new Set(['wrong_status', 'booking_not_found', 'quote_changed', 'quote_expired']);

const PICKUP_DAYS = 2;

const FROM_BOOKINGS: VehicleHistoryLinkState = { from: 'bookings' };

export interface ClientBookingCardProps {
  booking: ClientBooking;
  reviewWindowDays: number;
  now: Date;
  /** An action went through: the booking as the database returned it. */
  onDone: (row: Booking) => void;
  /** A review was sent. */
  onReviewed: (id: string, review: { id: string; rating: number }) => void;
  /** Opened from the review request (T19d): the review form shows at once, when it can be left. */
  openReview?: boolean;
  /** The booking changed under this card: read the list again. */
  onStale: () => void;
}

/**
 * T27: whether the shop may see what was done on this car at other shops (no prices, no shop names),
 * while the booking is open; the client turns it on or off here at any time.
 */
function ShareRow({ booking: b, act }: { booking: ClientBooking; act: (run: () => Promise<Booking>) => Promise<void> }) {
  const { t, lang } = useI18n();
  const on = b.share_history;
  return (
    <div className={styles.share} role="group" aria-label={t('cb.share.title')}>
      <History size={18} aria-hidden="true" className={styles.shareIcon} />
      <p className={styles.shareText}>
        <span className={styles.shareTitle}>{t('cb.share.title')}</span>
        <span className={styles.muted}>{t(on ? 'cb.share.on' : 'cb.share.off')}</span>
      </p>
      <ActionButton
        variant="secondary"
        block={false}
        onAction={(rid) => act(() => setBookingHistoryShare(b.id, !on, rid))}
        errorMessage={(e) => rpcErrorMessage(lang, e)}
        canRetry={canRetryRpc}
      >
        {t(on ? 'cb.share.turnOff' : 'cb.share.turnOn')}
      </ActionButton>
    </div>
  );
}

/** Requests that never reached the shop's work: the offer no longer applies to them. */
const OFFER_GONE = new Set(['declined', 'cancelled', 'expired']);

/**
 * One booking in the client's Programări (FR §3.5, P10b, P15, P15c): service, shop, day and time,
 * car and status; what the status means now (the quote to decide on, the job in progress, the
 * finished job with odometer, work and amount); and what the client can do: cancel while allowed,
 * review a finished job once, book again, see the car's history (T10). Every write goes through a
 * database function.
 */
export function ClientBookingCard({
  booking: b,
  reviewWindowDays,
  now,
  onDone,
  onReviewed,
  onStale,
  openReview,
}: ClientBookingCardProps) {
  const { t, lang } = useI18n();
  const quote = quoteOf(b);
  const car = [[b.car_snapshot.make, b.car_snapshot.model].filter(Boolean).join(' '), b.car_snapshot.plate].filter(Boolean).join(' · ');
  const cancel = cancelState(b, b.shop?.cancel_deadline_hours ?? 0, now);
  const review = reviewState(b, b.review !== null, reviewWindowDays, now);
  const [panel, setPanel] = useState<'cancel' | 'review' | null>(() => (openReview && review === 'open' ? 'review' : null));
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
  // A request the shop never answered: other shops for the same work, in the same city.
  const findAnother = b.status === 'expired' && b.closed_reason === 'unanswered';
  // "Mesaj" is on every card, so the actions row always shows while no panel is open.
  const hasActions = panel === null;

  return (
    <Card highlight={b.status === 'quote_sent'} className={styles.card}>
      <div className={styles.top}>
        <ServiceIcon name={b.service?.icon} className={styles.icon} />
        <div className={styles.what}>
          <p className={styles.service}>{bookingServicesText(lang, b.service, b.extra_services, b.service_id)}</p>
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
      {b.offer_percent !== null && !OFFER_GONE.has(b.status) && <OfferNote>{t('offer.client', { n: b.offer_percent })}</OfferNote>}
      {b.loyalty_percent !== null && !OFFER_GONE.has(b.status) && <OfferNote>{t('loyalty.client', { n: b.loyalty_percent })}</OfferNote>}

      <StatusDetail booking={b} quote={quote} now={now} />
      {isActiveStatus(b.status) && panel === null && <ShareRow booking={b} act={act} />}
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
            <Link to={`${bookingPath(b.shop_id)}?pas=2&serviciu=${[b.service_id, ...b.extra_service_ids].map(encodeURIComponent).join(',')}`} className={buttonClass('secondary')}>
              {t('cb.bookAgain')}
            </Link>
          )}
          {b.status === 'confirmed' && b.shop && (
            <CalendarLinks
              event={{
                uid: b.id,
                title: `${bookingServicesText(lang, b.service, b.extra_services, b.service_id)} · ${b.shop.name}`,
                date: b.date,
                slot: b.slot,
                minutes: b.shop.slot_minutes,
                location: [b.shop.name, b.shop.street, b.shop.city].filter(Boolean).join(', '),
                description: t('calendar.description', { ref: b.ref }),
              }}
              place={b.shop}
            />
          )}
          {findAnother && (
            <Link to={otherShopsPath(b)} className={buttonClass('primary')}>
              {t('cb.unanswered.find')}
            </Link>
          )}
          {b.status === 'done' && (
            <Link to={bookingCarHistoryPath(b.id)} state={FROM_BOOKINGS} className={buttonClass('secondary')}>
              {t('vh.see')}
            </Link>
          )}
          <MessageLink side="client" bookingId={b.id} />
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
/** The search for the same kind of work in the shop's city. */
function otherShopsPath(b: ClientBooking): string {
  const q = new URLSearchParams();
  if (b.service?.category_key) q.set('cat', b.service.category_key);
  if (b.shop?.city) q.set('oras', b.shop.city);
  const search = q.toString();
  return search ? `${SEARCH_PATH}?${search}` : SEARCH_PATH;
}

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
      return (
        <p className={styles.muted}>
          {t(b.closed_reason === 'unanswered' ? 'cb.unanswered' : b.closed_reason === 'not_updated' ? 'cb.notUpdated' : 'cb.expired')}
        </p>
      );
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
