import { Building2, ClipboardCheck, History, MessageSquare, Phone, RotateCcw, Star } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { WarrantyNote } from '../../../components/WarrantyNote';
import { ActionButton } from '../../../components/ActionButton';
import { JobDocuments } from '../../../components/JobDocuments';
import { BookingProgress } from '../../../components/BookingProgress';
import { Button } from '../../../components/Button';
import { buttonClass } from '../../../components/buttonClass';
import { calendarMenuItems } from '../../../components/calendarMenu';
import { MoreActions } from '../../../components/MoreActions';
import { Card } from '../../../components/Card';
import { OfferNote } from '../../../components/OfferNote';
import { useOfferText } from '../../../lib/useOfferText';
import { InlinePanel } from '../../../components/InlinePanel';
import { ServiceIcon } from '../../../components/ServiceIcon';
import { StatusBadge } from '../../../components/StatusBadge';
import { SuccessCheck } from '../../../components/SuccessCheck';
import { quoteOf, type ClientBooking } from '../../../data/bookings';
import type { NoShowDispute } from '../../../data/noShows';
import {
  cancelBooking,
  canRetryRpc,
  rpcErrorMessage,
  toRpcError,
  type Booking,
  type RpcErrorCode,
} from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { daysFromToday, formatDate, formatKm, formatMoney, formatTime, ymdInBucharest } from '../../../i18n/format';
import { bookingServicesText } from '../../../lib/bookingServices';
import { cancelState, reviewState, type Quote } from '../../../lib/clientBookings';
import { quantityDetail, vatOf } from '../../../lib/quoteSections';
import { formatPhone, normalizePhone } from '../../../lib/validators';
import { bookingMessagesPath } from '../../messages/paths';
import { bookingCarHistoryPath, bookingIntakePath, bookingPath, SEARCH_PATH, type VehicleHistoryLinkState } from '../paths';
import { NoShowDisputePanel, NoShowDisputeStatus } from './NoShowDispute';
import { fleetSpacePath } from '../companies/paths';
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
  /** A no-show (T53): its dispute, and whether it may still be contested. */
  noShow?: { dispute: NoShowDispute | null; disputable: boolean };
  /** A dispute was sent: read the no-shows again. */
  onDisputed?: () => void;
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
  noShow,
  onDisputed,
}: ClientBookingCardProps) {
  const { t, lang } = useI18n();
  const offerText = useOfferText();
  const quote = quoteOf(b);
  const car = [[b.car_snapshot.make, b.car_snapshot.model].filter(Boolean).join(' '), b.car_snapshot.plate].filter(Boolean).join(' · ');
  const cancel = cancelState(b, b.shop?.cancel_deadline_hours ?? 0, now);
  const review = reviewState(b, b.review !== null, reviewWindowDays, now);
  const [panel, setPanel] = useState<'cancel' | 'review' | 'dispute' | null>(() => (openReview && review === 'open' ? 'review' : null));
  // A dispute sent from this card shows at once, before the list is read again.
  const [sentDispute, setSentDispute] = useState<NoShowDispute | null>(null);
  const dispute = b.status === 'no_show' ? (sentDispute ?? noShow?.dispute ?? null) : null;
  const disputable = b.status === 'no_show' && !dispute && (noShow?.disputable ?? false);
  const shopName = b.shop?.name ?? '';
  // Just decided here: the outcome comes with a check that draws itself (src/lib/motion.ts).
  const [decided, setDecided] = useState(false);

  /** Runs one RPC; an outdated card makes the list reload. */
  async function act(run: () => Promise<Booking>): Promise<void> {
    try {
      const row = await run();
      setPanel(null);
      setDecided(true);
      onDone(row);
    } catch (e) {
      if (STALE.has(toRpcError(e).code)) onStale();
      throw e;
    }
  }

  const bookAgain = b.status === 'done' && b.shop;
  const bookAgainPath = `${bookingPath(b.shop_id)}?pas=2&serviciu=${[b.service_id, ...b.extra_service_ids].map(encodeURIComponent).join(',')}`;
  // A request the shop never answered: other shops for the same work, in the same city.
  const findAnother = b.status === 'expired' && b.closed_reason === 'unanswered';
  // "Mesaj" is on every card (in "Mai multe"), so the actions row always shows while no panel is open.
  const hasActions = panel === null;

  // A wide card (T58) puts the quote, its decision or the finished job on the right of the booking.
  const aside =
    b.status === 'quote_sent' && quote && b.company_id ? (
      // A company car (T63d): the company answers, in its fleet space.
      <div className={styles.companyQuote}>
        <p className={styles.muted}>
          <Building2 size={16} aria-hidden="true" /> {t('cb.company.quote')}
        </p>
        <Link to={`${fleetSpacePath(b.company_id)}?sectiune=programari`} className={buttonClass('secondary')}>
          {t('cb.company.open')}
        </Link>
      </div>
    ) : b.status === 'quote_sent' && quote ? (
      // A replaced quote starts with every line ticked again.
      <QuoteDecision key={quote.id} bookingId={b.id} quote={quote} act={act} />
    ) : (b.status === 'approved' && quote) || b.status === 'done' ? (
      <StatusDetail booking={b} quote={quote} now={now} decided={decided} />
    ) : b.status === 'in_progress' && quote ? (
      <DecidedLines quote={quote} />
    ) : null;
  const statusInMain = !(b.status === 'approved' && quote) && b.status !== 'done';

  return (
    <Card highlight={b.status === 'quote_sent' && !b.company_id} className={`${styles.card} ${aside ? styles.split : ''}`}>
      <div className={styles.main}>
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
            {formatDate(lang, b.date)}, <span className={styles.keep}>{b.slot.slice(0, 5)}</span>
          </span>
          <span className={`mono ${styles.ref}`}>
            {' · '}
            <span className={styles.keep}>{b.ref}</span>
          </span>
          {b.status === 'done' && b.odometer !== null && (
            <span className="mono">
              {' · '}
              <span className={styles.keep}>{formatKm(lang, b.odometer)}</span>
            </span>
          )}
          {car && <span className={styles.muted}> · {car}</span>}
          {b.company_id && <span className={styles.muted}> · {t('cb.company.badge')}</span>}
        </p>
        {b.status === 'done' && <WarrantyNote months={b.warranty_months} until={b.warranty_until} />}
        {b.status !== 'done' && <BookingProgress status={b.status} />}
        {b.note && <p className={styles.note}>{b.note}</p>}
        {b.offer_percent !== null && !OFFER_GONE.has(b.status) && <OfferNote>{offerText.promise('client', b.offer_percent, b.offer_kind)}</OfferNote>}
        {b.loyalty_percent !== null && !OFFER_GONE.has(b.status) && <OfferNote>{t('loyalty.client', { n: b.loyalty_percent })}</OfferNote>}

        {statusInMain && <StatusDetail booking={b} quote={quote} now={now} decided={decided} />}
        {dispute && <NoShowDisputeStatus dispute={dispute} />}
      </div>
      {aside && <div className={styles.aside}>{aside}</div>}
      <div className={styles.extra}>
        {b.intake_sent_at && !b.intake_confirmed_at && (
          <Link to={bookingIntakePath(b.id)} className={styles.intakePrompt}>
            <ClipboardCheck size={18} aria-hidden="true" />
            <span>
              <strong>{t('cin.prompt.title')}</strong>
              <span className={styles.block}>{t('cin.prompt.body')}</span>
            </span>
          </Link>
        )}
        <JobDocuments
          bookingId={b.id}
          bookingRef={b.ref}
          quoteNumber={b.quote_number}
          kinds={[
            ...(b.status === 'done' && quote ? (['final'] as const) : []),
            ...(quote ? (['quote'] as const) : []),
            ...(b.intake_sent_at ? (['intake'] as const) : []),
          ]}
        />
      </div>

      {hasActions && (
        <div className={styles.actions}>
          {/* One main action in sight; the rest behind "Mai multe" (Eduard, 10 Oct). */}
          {review === 'open' ? (
            <Button variant="primary" onClick={() => setPanel('review')}>
              {t('cb.review.leave')}
            </Button>
          ) : findAnother ? (
            <Link to={otherShopsPath(b)} className={buttonClass('primary')}>
              {t('cb.unanswered.find')}
            </Link>
          ) : bookAgain ? (
            <Link to={bookAgainPath} className={buttonClass('secondary')}>
              {t('cb.bookAgain')}
            </Link>
          ) : disputable ? (
            <Button variant="secondary" onClick={() => setPanel('dispute')}>
              {t('cb.dispute.action')}
            </Button>
          ) : null}
          <MoreActions
            items={[
              ...(b.status === 'confirmed' && b.shop
                ? calendarMenuItems(
                    {
                      uid: b.id,
                      title: `${bookingServicesText(lang, b.service, b.extra_services, b.service_id)} · ${b.shop.name}`,
                      date: b.date,
                      slot: b.slot,
                      minutes: b.shop.slot_minutes,
                      location: [b.shop.name, b.shop.street, b.shop.city].filter(Boolean).join(', '),
                      description: t('calendar.description', { ref: b.ref }),
                    },
                    b.shop,
                    t,
                  )
                : []),
              ...(bookAgain && (review === 'open' || findAnother)
                ? [{ key: 'again', label: t('cb.bookAgain'), icon: <RotateCcw size={18} aria-hidden="true" />, to: bookAgainPath }]
                : []),
              ...(b.intake_confirmed_at
                ? [{ key: 'intake', label: t('cin.title'), icon: <ClipboardCheck size={18} aria-hidden="true" />, to: bookingIntakePath(b.id) }]
                : []),
              ...(b.status === 'done'
                ? [{ key: 'history', label: t('vh.see'), icon: <History size={18} aria-hidden="true" />, to: bookingCarHistoryPath(b.id), state: FROM_BOOKINGS }]
                : []),
              { key: 'message', label: t('msg.button'), icon: <MessageSquare size={18} aria-hidden="true" />, to: bookingMessagesPath('client', b.id) },
              ...(cancel === 'allowed' ? [{ key: 'cancel', label: t('cb.cancel'), onSelect: () => setPanel('cancel'), danger: true }] : []),
            ]}
          />
          {review === 'sent' && (
            <p className={styles.reviewSent}>
              {decided ? <SuccessCheck size={20} /> : <Star size={15} aria-hidden="true" className={styles.starFilled} />}
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
      {panel === 'dispute' && (
        <NoShowDisputePanel
          bookingId={b.id}
          onSent={(d) => {
            setSentDispute(d);
            setPanel(null);
            onDisputed?.();
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'review' && (
        <ReviewForm
          bookingId={b.id}
          shopName={shopName}
          onSent={(r) => {
            setPanel(null);
            setDecided(true);
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
          const detail = quantityDetail(lang, item);
          return (
            <li key={item.id} className={`${styles.quoteLine} ${refused ? styles.refused : ''}`}>
              <span className={styles.lineName}>
                {item.name}
                {refused && <span className="visually-hidden">, {t('cb.quote.refusedLine')}</span>}
                {detail && <span className={styles.lineDetail}>{detail}</span>}
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
      {quote.vat_rate != null && (
        <p className={styles.quoteVat}>
          {t('quote.vatIncluded', { rate: quote.vat_rate, vat: formatMoney(lang, vatOf(quote.total_approved ?? quote.total_sent, quote.vat_rate)) })}
        </p>
      )}
    </div>
  );
}

/** What the status means right now (P15 "Status display for the client"). */
function StatusDetail({
  booking: b,
  quote,
  now,
  decided,
}: {
  booking: ClientBooking;
  quote: Quote | null;
  now: Date;
  decided: boolean;
}) {
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
          <p className={decided ? `${styles.ok} ${styles.okFresh}` : styles.ok}>
            {decided && <SuccessCheck size={30} />}
            <span>
              {quote.status === 'partially_accepted'
                ? t('cb.approvedPartial', { n: accepted, total: quote.items.length, amount })
                : t('cb.approved', { amount })}
            </span>
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
