import { Building2, ClipboardCheck, History, MessageSquare, Phone, RotateCcw, Star } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { BookingProgress } from '../../../components/BookingProgress';
import { Button } from '../../../components/Button';
import { buttonClass } from '../../../components/buttonClass';
import { calendarMenuItems } from '../../../components/calendarMenu';
import { InlinePanel } from '../../../components/InlinePanel';
import { JobDocuments } from '../../../components/JobDocuments';
import { DetailFacts, DetailPane, DetailSection, type DetailMessage } from '../../../components/ListDetailLayout';
import { MoreActions } from '../../../components/MoreActions';
import { OfferNote } from '../../../components/OfferNote';
import { ServiceIcon } from '../../../components/ServiceIcon';
import { StatusPill } from '../../../components/StatusPill';
import { SuccessCheck } from '../../../components/SuccessCheck';
import { WarrantyNote } from '../../../components/WarrantyNote';
import { quoteOf, type ClientBooking } from '../../../data/bookings';
import type { NoShowDispute } from '../../../data/noShows';
import { cancelBooking, canRetryRpc, rpcErrorMessage, toRpcError, type Booking, type RpcErrorCode } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { daysFromToday, formatDate, formatKm, formatMoney, formatTime, ymdInBucharest } from '../../../i18n/format';
import { bookingServicesText } from '../../../lib/bookingServices';
import { cancelState, clientTone, reviewState, type Quote } from '../../../lib/clientBookings';
import { quantityDetail, vatOf } from '../../../lib/quoteSections';
import { useOfferText } from '../../../lib/useOfferText';
import { formatPhone, normalizePhone } from '../../../lib/validators';
import { bookingMessagesPath } from '../../messages/paths';
import { fleetSpacePath } from '../companies/paths';
import { bookingCarHistoryPath, bookingIntakePath, bookingPath, SEARCH_PATH, type VehicleHistoryLinkState } from '../paths';
import { NoShowDisputePanel, NoShowDisputeStatus } from './NoShowDispute';
import { QuoteAnswer, QuoteLinesChoice } from './QuoteDecision';
import { ReviewForm } from './ReviewForm';
import { useQuoteChoice } from './useQuoteChoice';
import styles from './bookings.module.css';

/** Answers meaning the detail shows an outdated booking or quote: read the list again. */
const STALE: ReadonlySet<RpcErrorCode> = new Set(['wrong_status', 'booking_not_found', 'quote_changed', 'quote_expired']);

const PICKUP_DAYS = 2;

const FROM_BOOKINGS: VehicleHistoryLinkState = { from: 'bookings' };

/** Requests that never reached the shop's work: the offer no longer applies to them. */
const OFFER_GONE = new Set(['declined', 'cancelled', 'expired']);

export interface ClientBookingDetailProps {
  booking: ClientBooking;
  reviewWindowDays: number;
  now: Date;
  /** An action went through: the booking as the database returned it. */
  onDone: (row: Booking) => void;
  /** A review was sent. */
  onReviewed: (id: string, review: { id: string; rating: number }) => void;
  /** Opened from the review request (T19d): the review form shows at once, when it can be left. */
  openReview?: boolean;
  /** The booking changed under this detail: read the list again. */
  onStale: () => void;
  /** A no-show (T53): its dispute, and whether it may still be contested. */
  noShow?: { dispute: NoShowDispute | null; disputable: boolean };
  /** A dispute was sent: read the no-shows again. */
  onDisputed?: () => void;
}

/**
 * One booking of the client's Programări, in full (page template A; FR §3.5, P10b, P15, P15c): its
 * head (service, shop, status), what the status means now, the booking, the quote to answer or the
 * job, the documents, and what the client can do — answer the quote, cancel while allowed, review
 * a finished job once, contest a no-show, book again, message the shop. Every write goes through a
 * database function.
 */
export function ClientBookingDetail(props: ClientBookingDetailProps) {
  const quote = quoteOf(props.booking);
  // A quote of the client's own car to answer: its lines in the content, its answer with the actions.
  // A replaced quote starts with every line ticked again.
  return props.booking.status === 'quote_sent' && quote && !props.booking.company_id ? (
    <QuoteDetail key={quote.id} {...props} quote={quote} />
  ) : (
    <Detail {...props} quote={quote} />
  );
}

function QuoteDetail(props: ClientBookingDetailProps & { quote: Quote }) {
  const choice = useQuoteChoice(props.quote);
  return <Detail {...props} choice={choice} />;
}

function Detail({
  booking: b,
  quote,
  choice,
  reviewWindowDays,
  now,
  onDone,
  onReviewed,
  onStale,
  openReview,
  noShow,
  onDisputed,
}: ClientBookingDetailProps & { quote: Quote | null; choice?: ReturnType<typeof useQuoteChoice> }) {
  const { t, lang } = useI18n();
  const offerText = useOfferText();
  const cancel = cancelState(b, b.shop?.cancel_deadline_hours ?? 0, now);
  const review = reviewState(b, b.review !== null, reviewWindowDays, now);
  const [panel, setPanel] = useState<'cancel' | 'review' | 'dispute' | null>(() => (openReview && review === 'open' ? 'review' : null));
  // A dispute sent from here shows at once, before the list is read again.
  const [sentDispute, setSentDispute] = useState<NoShowDispute | null>(null);
  const dispute = b.status === 'no_show' ? (sentDispute ?? noShow?.dispute ?? null) : null;
  const disputable = b.status === 'no_show' && !dispute && (noShow?.disputable ?? false);
  const shopName = b.shop?.name ?? '';
  // Just decided here: the outcome comes with a check that draws itself (src/lib/motion.ts).
  const [decided, setDecided] = useState(false);
  const service = bookingServicesText(lang, b.service, b.extra_services, b.service_id);
  const car = [[b.car_snapshot.make, b.car_snapshot.model].filter(Boolean).join(' '), b.car_snapshot.plate].filter(Boolean).join(' · ');

  /** Runs one RPC; an outdated booking makes the list reload. */
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
  const reason = (text: string | null) => (text ? <p className={styles.reason}>{t('cb.reason', { reason: text })}</p> : null);

  const more = [
    ...(b.status === 'confirmed' && b.shop
      ? calendarMenuItems(
          {
            uid: b.id,
            title: `${service} · ${b.shop.name}`,
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
  ];

  // The one main action in sight (Eduard, 10 Oct; page templates): the rest behind „Mai multe”.
  const answer = choice && quote ? <QuoteAnswer bookingId={b.id} quote={quote} choice={choice} act={act} /> : null;
  const main: ReactNode =
    answer ? (
      answer
    ) : review === 'open' ? (
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
    ) : null;

  const refusing = choice?.refusing ?? false;

  return (
    <DetailPane
      id={b.id}
      icon={<ServiceIcon name={b.service?.icon} size={20} />}
      title={service}
      detail={b.shop ? `${b.shop.name} · ${b.shop.city}` : undefined}
      status={<StatusPill tone={clientTone(b)}>{t(`status.${b.status}`)}</StatusPill>}
      message={statusMessage(b, quote, now, decided, t, lang)}
      documents={
        <JobDocuments
          bookingId={b.id}
          bookingRef={b.ref}
          quoteNumber={b.quote_number}
          // 107: the documents of a company booking read without costs.view are refused by the server.
          kinds={
            b.money_hidden
              ? []
              : [
                  ...(b.status === 'done' && quote ? (['final'] as const) : []),
                  ...(quote ? (['quote'] as const) : []),
                  ...(b.intake_sent_at ? (['intake'] as const) : []),
                ]
          }
        />
      }
      actions={
        <>
          {main}
          <MoreActions items={more} />
          {review === 'sent' && (
            <p className={styles.reviewSent}>
              {decided ? <SuccessCheck size={20} /> : <Star size={15} aria-hidden="true" className={styles.starFilled} />}
              {t('cb.review.sent')}
            </p>
          )}
        </>
      }
      panel={
        refusing ? (
          // „Refuz” asks first, in the actions' place.
          answer
        ) : panel === 'cancel' ? (
          <InlinePanel title={t('cb.cancel.title')} onClose={() => setPanel(null)}>
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
        ) : panel === 'dispute' ? (
          <NoShowDisputePanel
            bookingId={b.id}
            onSent={(d) => {
              setSentDispute(d);
              setPanel(null);
              onDisputed?.();
            }}
            onClose={() => setPanel(null)}
          />
        ) : panel === 'review' ? (
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
        ) : undefined
      }
    >
      {b.status !== 'done' && <BookingProgress status={b.status} />}

      {b.intake_sent_at && !b.intake_confirmed_at && (
        <Link to={bookingIntakePath(b.id)} className={styles.intakePrompt}>
          <ClipboardCheck size={18} aria-hidden="true" />
          <span>
            <strong>{t('cin.prompt.title')}</strong>
            <span className={styles.block}>{t('cin.prompt.body')}</span>
          </span>
        </Link>
      )}

      {choice && quote && (
        <DetailSection title={t('bd.section.quote')}>
          <div className={styles.quote}>
            <QuoteLinesChoice quote={quote} choice={choice} />
          </div>
        </DetailSection>
      )}

      {b.status === 'quote_sent' && quote && b.company_id && (
        // A company car (T63d): the company answers, in its fleet space.
        // (What it means is the status message.)
        <div className={styles.companyQuote}>
          <Link to={`${fleetSpacePath(b.company_id)}?sectiune=programari`} className={buttonClass('secondary')}>
            <Building2 size={18} aria-hidden="true" />
            {t('cb.company.open')}
          </Link>
        </div>
      )}

      {(b.status === 'approved' || b.status === 'in_progress') && quote && (
        <DetailSection title={t('bd.section.quote')}>
          <DecidedLines quote={quote} hideMoney={b.money_hidden} />
        </DetailSection>
      )}

      {b.status === 'done' && (b.work || b.cost !== null) && (
        <DetailSection title={t('bd.section.job')}>
          <DetailFacts
            items={[
              ...(b.work ? [{ label: t('cb.done.work'), value: b.work }] : []),
              ...(b.cost !== null ? [{ label: t('cb.done.cost'), value: <span className="mono">{formatMoney(lang, b.cost)}</span> }] : []),
            ]}
          />
          <WarrantyNote months={b.warranty_months} until={b.warranty_until} />
        </DetailSection>
      )}

      <DetailSection title={t('bd.section.booking')}>
        <DetailFacts
          items={[
            {
              label: t('bd.fact.when'),
              value: (
                <span className="mono">
                  {formatDate(lang, b.date)}, {b.slot.slice(0, 5)}
                </span>
              ),
            },
            ...(car ? [{ label: t('bd.fact.car'), value: b.company_id ? `${car} · ${t('cb.company.badge')}` : car }] : []),
            ...(b.status === 'done' && b.odometer !== null ? [{ label: t('bd.fact.odometer'), value: <span className="mono">{formatKm(lang, b.odometer)}</span> }] : []),
            { label: t('bd.fact.ref'), value: <span className="mono">{b.ref}</span> },
          ]}
        />
        {b.note && (
          <p className={styles.note}>
            <span className="visually-hidden">{t('bd.fact.note')}: </span>
            {b.note}
          </p>
        )}
        {b.offer_percent !== null && !OFFER_GONE.has(b.status) && <OfferNote>{offerText.promise('client', b.offer_percent, b.offer_kind)}</OfferNote>}
        {b.loyalty_percent !== null && !OFFER_GONE.has(b.status) && <OfferNote>{t('loyalty.client', { n: b.loyalty_percent })}</OfferNote>}
        {b.status === 'declined' && reason(b.decline_reason)}
        {b.status === 'cancelled' && b.cancelled_by !== 'client' && reason(b.cancel_reason)}
        {dispute && <NoShowDisputeStatus dispute={dispute} />}
      </DetailSection>

      {panel === null && cancel === 'deadline_passed' && (
        <DetailSection title={t('bd.section.cancelling')}>
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
        </DetailSection>
      )}
    </DetailPane>
  );
}

/** What the status means now (P15 "Status display for the client"), on the shade of its color. */
function statusMessage(
  b: ClientBooking,
  quote: Quote | null,
  now: Date,
  decided: boolean,
  t: ReturnType<typeof useI18n>['t'],
  lang: ReturnType<typeof useI18n>['lang'],
): DetailMessage | undefined {
  /** `09:20`, or `Lun 13 oct, 09:20` when it was not today. */
  const at = (iso: string) => {
    const d = new Date(iso);
    const time = formatTime(lang, d);
    return daysFromToday(ymdInBucharest(d), now) === 0 ? time : `${formatDate(lang, d)}, ${time}`;
  };
  switch (b.status) {
    case 'pending':
      return { tone: 'neutral', text: t('cb.pending') };
    case 'in_inspection':
      return { tone: 'neutral', text: `${t('cb.inspection')}. ${t('cb.inspectionBody')}` };
    case 'quote_sent':
      return b.company_id ? { tone: 'neutral', text: t('cb.company.quote') } : { tone: 'action', text: t('cb.quote.ask') };
    case 'approved': {
      if (!quote) return undefined;
      const accepted = quote.items.filter((i) => i.approved).length;
      const amount = formatMoney(lang, quote.total_approved ?? quote.total_sent);
      const text = b.money_hidden
        ? t('cb.company.approved')
        : quote.status === 'partially_accepted'
          ? t('cb.approvedPartial', { n: accepted, total: quote.items.length, amount })
          : t('cb.approved', { amount });
      return {
        tone: 'success',
        text: decided ? (
          <span className={styles.okFresh}>
            <SuccessCheck size={24} />
            {text}
          </span>
        ) : (
          text
        ),
      };
    }
    case 'in_progress':
      return { tone: 'neutral', text: b.started_at ? `${t('cb.inProgress')} ${t('cb.inProgressSince', { time: at(b.started_at) })}` : t('cb.inProgress') };
    case 'done':
      return pickupState(b.done_at, now) ? { tone: 'success', text: t('cb.done') } : { tone: 'closed', text: t('cb.doneOld') };
    case 'quote_refused': {
      if (b.money_hidden) return { tone: 'closed', text: t('cb.company.refused') };
      const fee = b.cost ?? quote?.inspection_fee ?? 0;
      return { tone: 'closed', text: fee > 0 ? t('cb.quoteRefused', { fee: formatMoney(lang, fee) }) : t('cb.quoteRefusedNoFee') };
    }
    case 'expired':
      return {
        tone: 'closed',
        text: t(b.closed_reason === 'unanswered' ? 'cb.unanswered' : b.closed_reason === 'not_updated' ? 'cb.notUpdated' : 'cb.expired'),
      };
    case 'no_show':
      return { tone: 'closed', text: t('cb.noShow') };
    case 'declined':
      return { tone: 'closed', text: t('cb.declined') };
    case 'cancelled':
      return {
        tone: 'closed',
        text: b.cancelled_by === 'shop' ? t('cb.cancelledShop') : b.cancelled_by === 'admin' ? t('cb.cancelledAdmin') : t('cb.cancelledClient'),
      };
    default:
      return undefined;
  }
}

/** The search for the same kind of work in the shop's city. */
function otherShopsPath(b: ClientBooking): string {
  const q = new URLSearchParams();
  if (b.service?.category_key) q.set('cat', b.service.category_key);
  if (b.shop?.city) q.set('oras', b.shop.city);
  const search = q.toString();
  return search ? `${SEARCH_PATH}?${search}` : SEARCH_PATH;
}

/** "Gata de ridicare" while the job is fresh (finished today or in the last 2 days), then "Lucrare finalizată". */
function pickupState(doneAt: string | null, now: Date): boolean {
  return doneAt !== null && daysFromToday(ymdInBucharest(new Date(doneAt)), now) >= -PICKUP_DAYS;
}

/** The accepted quote after the decision: refused lines struck through (and said in words). */
function DecidedLines({ quote, hideMoney = false }: { quote: Quote; hideMoney?: boolean }) {
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
              {!hideMoney && <span className="mono">{formatMoney(lang, item.price)}</span>}
            </li>
          );
        })}
      </ul>
      {/* 107: a company booking for a member without costs.view comes without amounts. */}
      {!hideMoney && (
        <>
          <p className={styles.quoteTotal}>
            <span>{t('cb.quote.totalApproved')}</span>
            <span className="mono">{formatMoney(lang, quote.total_approved ?? quote.total_sent)}</span>
          </p>
          {quote.vat_rate != null && (
            <p className={styles.quoteVat}>
              {t('quote.vatIncluded', { rate: quote.vat_rate, vat: formatMoney(lang, vatOf(quote.total_approved ?? quote.total_sent, quote.vat_rate)) })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
