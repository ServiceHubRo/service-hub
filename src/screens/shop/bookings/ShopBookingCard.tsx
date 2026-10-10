import { CalendarClock, ClipboardList, FilePen, MessageSquare, Phone, Store, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { ActionButton } from '../../../components/ActionButton';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { MoreActions } from '../../../components/MoreActions';
import { ServiceIcon } from '../../../components/ServiceIcon';
import { StatusBadge } from '../../../components/StatusBadge';
import { OfferNote } from '../../../components/OfferNote';
import { useOfferText } from '../../../lib/useOfferText';
import {
  canRetryRpc,
  confirmBooking,
  declineBooking,
  markNoShow,
  rpcErrorMessage,
  shopCancelBooking,
  startInspection,
  startWork,
  toRpcError,
  withdrawQuote,
  type Booking,
} from '../../../data/rpc';
import { isUnclaimedWalkIn, type ShopBooking } from '../../../data/shopBookings';
import { useI18n } from '../../../i18n/context';
import { daysFromToday, formatDate, formatMoney, formatTime, ymdInBucharest } from '../../../i18n/format';
import { rowServicesText } from '../../../lib/bookingServices';
import { slotStarted } from '../../../lib/shopBookings';
import { formatPhone, normalizePhone } from '../../../lib/validators';
import { ConfirmPanel, ReasonPanel } from './BookingPanels';
import { ClientAnswerPanel } from './ClientAnswerPanel';
import { CompletionPanel } from './CompletionPanel';
import { QuoteComposer } from './QuoteComposer';
import { QuoteLines } from './QuoteLines';
import { ReschedulePanel } from './ReschedulePanel';
import { bookingMessagesPath } from '../../messages/paths';
import { vehicleFilePath } from '../paths';
import styles from './shopBookings.module.css';

type PanelKind = 'decline' | 'reschedule' | 'cancel' | 'noShow' | 'quote' | 'editQuote' | 'withdraw' | 'complete' | 'answer';

/** From 3 no-shows in 90 days shops see a discreet line (ARCHITECTURE §6); no automatic block. */
const NO_SHOW_MARK = 3;

export interface ShopBookingCardProps {
  booking: ShopBooking;
  shopId: string;
  /** The shop's inspection fee now (the composer shows it). */
  fee: number;
  expiryDays: number;
  now: Date;
  /** An action went through: the booking as the database returned it. */
  onDone: (before: ShopBooking, after: Booking) => void;
  /** The booking changed under this card (another device, the client): read the list again. */
  onStale: () => void;
}

/**
 * One booking in the shop's Programări (P8, P15, FR §4.2): service, day and time, status; the car,
 * the client with tap-to-call, account id, note and the no-show mark; the quote once sent; and the
 * actions the status allows. Every action opens inside the card (no dialogs) and goes through a
 * database function; the buttons only mirror what the database allows.
 */
export function ShopBookingCard({ booking: b, shopId, fee, expiryDays, now, onDone, onStale }: ShopBookingCardProps) {
  const { t, lang } = useI18n();
  const offerText = useOfferText();
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const started = slotStarted(b, now);

  /** Runs one RPC; a booking that moved on meanwhile makes the list reload. */
  async function act(run: () => Promise<Booking>): Promise<void> {
    try {
      const row = await run();
      setPanel(null);
      onDone(b, row);
    } catch (e) {
      const code = toRpcError(e).code;
      if (code === 'wrong_status' || code === 'booking_not_found') onStale();
      throw e;
    }
  }

  const close = () => setPanel(null);
  const service = rowServicesText(lang, b);
  const car = [b.car_snapshot.make, b.car_snapshot.model, b.car_snapshot.year].filter(Boolean).join(' ');
  const plate = b.car_snapshot.plate;
  const phone = b.client_phone;
  const walkIn = isUnclaimedWalkIn(b);

  return (
    <Card highlight={b.status === 'pending'} className={styles.card}>
      <div className={styles.top}>
        <ServiceIcon name={b.service_icon} className={styles.icon} />
        <div className={styles.what}>
          <p className={styles.service}>{service}</p>
          <p className={styles.when}>
            <span className="mono">
              {formatDate(lang, b.date)}, {b.slot}
            </span>
            <span className={styles.ref}> · {b.ref}</span>
          </p>
        </div>
        <StatusBadge status={b.status} />
      </div>

      <Card inset className={styles.client}>
        <div className={styles.carRow}>
          <span className={styles.car}>{car || t('sb.card.noCar')}</span>
          {plate && <span className={`mono ${styles.plate}`}>{plate}</span>}
        </div>
        <p className={styles.clientName}>{b.client_name || t('sb.card.deletedClient')}</p>
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
        {b.client_account && (
          <p className={styles.muted}>
            {t('sb.card.account')} <span className="mono">{b.client_account}</span>
          </p>
        )}
        {b.client_no_shows >= NO_SHOW_MARK && (
          <p className={styles.muted}>{t('sb.card.noShows', { n: b.client_no_shows })}</p>
        )}
        {b.note && <p className={styles.note}>{b.note}</p>}
        {b.offer_percent ? <OfferNote>{offerText.promise('shop', b.offer_percent, b.offer_kind ?? null)}</OfferNote> : null}
        {b.loyalty_percent ? <OfferNote>{t('loyalty.shop', { n: b.loyalty_percent, level: b.loyalty_level ?? 1 })}</OfferNote> : null}
        {b.source === 'shop' && (
          <p className={styles.walkIn}>
            <Store size={14} aria-hidden="true" />
            {t('sb.card.walkIn')} ·{' '}
            {b.claimed ? t('sb.card.inAccount') : b.invite_sent_at ? t('sb.card.smsSent') : t('sb.card.noAccount')}
          </p>
        )}
      </Card>

      <StatusDetail booking={b} started={started} />

      {panel === null && (
        <div className={styles.actions}>
          {/* One main action in sight; the rest behind "Mai multe" (Eduard, 10 Oct). */}
          {b.status === 'pending' && !started && (
            <ActionButton
              variant="success"
              block={false}
              onAction={(rid) => act(() => confirmBooking(b.id, rid))}
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              canRetry={canRetryRpc}
            >
              {t('sb.action.confirm')}
            </ActionButton>
          )}
          {b.status === 'pending' && started && (
            <Button variant="danger" onClick={() => setPanel('decline')}>
              {t('sb.action.decline')}
            </Button>
          )}
          {b.status === 'confirmed' && (
            <ActionButton
              block={false}
              onAction={(rid) => act(() => startInspection(b.id, rid))}
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              canRetry={canRetryRpc}
            >
              {t('sb.action.inspect')}
            </ActionButton>
          )}
          {b.status === 'in_inspection' && (
            <Button variant="primary" onClick={() => setPanel('quote')}>
              {t('sb.action.sendQuote')}
            </Button>
          )}
          {b.status === 'quote_sent' && walkIn && b.quote && (
            <Button variant="primary" onClick={() => setPanel('answer')}>
              {t('sb.action.clientAnswer')}
            </Button>
          )}
          {b.status === 'approved' && (
            <ActionButton
              variant="success"
              block={false}
              onAction={(rid) => act(() => startWork(b.id, rid))}
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              canRetry={canRetryRpc}
            >
              {t('sb.action.startWork')}
            </ActionButton>
          )}
          {b.status === 'in_progress' && (
            <Button variant="success" onClick={() => setPanel('complete')}>
              {t('sb.action.complete')}
            </Button>
          )}
          <MoreActions
            items={[
              ...(b.status === 'pending' && !started
                ? [{ key: 'decline', label: t('sb.action.decline'), onSelect: () => setPanel('decline'), danger: true }]
                : []),
              ...(b.status === 'pending' || b.status === 'confirmed'
                ? [{ key: 'reschedule', label: t('sb.action.reschedule'), icon: <CalendarClock size={18} aria-hidden="true" />, onSelect: () => setPanel('reschedule') }]
                : []),
              ...(b.status === 'quote_sent'
                ? [
                    { key: 'editQuote', label: t('sb.action.editQuote'), icon: <FilePen size={18} aria-hidden="true" />, onSelect: () => setPanel('editQuote') },
                    { key: 'withdraw', label: t('sb.action.withdrawQuote'), onSelect: () => setPanel('withdraw'), danger: true },
                  ]
                : []),
              // A deleted client account has no conversation.
              ...(b.client_account
                ? [{ key: 'message', label: t('msg.button'), icon: <MessageSquare size={18} aria-hidden="true" />, to: bookingMessagesPath('shop', b.id) }]
                : []),
              { key: 'file', label: t('vf.title'), icon: <ClipboardList size={18} aria-hidden="true" />, to: vehicleFilePath(b.id, 'bookings') },
              ...(b.status === 'confirmed' && started
                ? [{ key: 'noShow', label: t('sb.action.noShow'), onSelect: () => setPanel('noShow') }]
                : []),
              ...(b.status === 'confirmed'
                ? [{ key: 'cancel', label: t('sb.action.cancel'), onSelect: () => setPanel('cancel'), danger: true }]
                : []),
            ]}
          />
        </div>
      )}

      {panel === 'decline' && (
        <ReasonPanel
          title={t('sb.decline.title')}
          label={t('sb.decline.submit')}
          required={false}
          onAction={(reason, rid) => act(() => declineBooking(b.id, reason || undefined, rid))}
          onClose={close}
        />
      )}
      {panel === 'cancel' && (
        <ReasonPanel
          title={t('sb.cancel.title')}
          body={t('sb.cancel.body')}
          label={t('sb.cancel.submit')}
          required
          onAction={(reason, rid) => act(() => shopCancelBooking(b.id, reason, rid))}
          onClose={close}
        />
      )}
      {panel === 'noShow' && (
        <ConfirmPanel
          title={t('sb.noShow.title')}
          body={t('sb.noShow.body', { when: `${formatDate(lang, b.date)}, ${b.slot}` })}
          label={t('sb.noShow.submit')}
          onAction={(rid) => act(() => markNoShow(b.id, rid))}
          onClose={close}
        />
      )}
      {panel === 'withdraw' && (
        <ConfirmPanel
          title={t('sb.withdraw.title')}
          body={t('sb.withdraw.body')}
          label={t('sb.withdraw.submit')}
          onAction={(rid) => act(() => withdrawQuote(b.id, rid))}
          onClose={close}
        />
      )}
      {panel === 'reschedule' && <ReschedulePanel booking={b} shopId={shopId} act={act} onClose={close} />}
      {panel === 'complete' && <CompletionPanel booking={b} act={act} onClose={close} />}
      {panel === 'answer' && b.quote && <ClientAnswerPanel booking={b} quote={b.quote} act={act} onClose={close} />}
      {(panel === 'quote' || panel === 'editQuote') && (
        <QuoteComposer
          booking={b}
          mode={panel === 'quote' ? 'send' : 'replace'}
          fee={fee}
          expiryDays={expiryDays}
          act={act}
          onClose={close}
        />
      )}
    </Card>
  );
}

/** What the status means right now, in one line (and the quote, once there is one). */
function StatusDetail({ booking: b, started }: { booking: ShopBooking; started: boolean }) {
  const { t, lang } = useI18n();
  /** `09:20`, or `Lun 13 oct, 09:20` when it was not today. */
  const at = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    const time = formatTime(lang, d);
    return daysFromToday(ymdInBucharest(d)) === 0 ? time : `${formatDate(lang, d)}, ${time}`;
  };

  switch (b.status) {
    case 'pending':
      return started ? (
        <p className={styles.warn}>
          <TriangleAlert size={16} aria-hidden="true" />
          {t('sb.detail.pendingPast')}
        </p>
      ) : null;
    case 'confirmed':
      return started ? <p className={styles.muted}>{t('sb.detail.confirmedPast')}</p> : null;
    case 'in_inspection':
      return <p className={styles.muted}>{t('sb.detail.inspection', { since: at(b.inspection_started_at) })}</p>;
    case 'quote_sent':
      return (
        <>
          {b.quote && <QuoteLines quote={b.quote} />}
          <p className={styles.muted}>
            {isUnclaimedWalkIn(b) ? t('sb.detail.quoteAtShop') : t('sb.detail.quoteWaiting')}
            {b.quote?.expires_at && <> {t('sb.detail.quoteExpires', { when: at(b.quote.expires_at) })}</>}
          </p>
        </>
      );
    case 'approved':
      return (
        <>
          {b.quote && <QuoteLines quote={b.quote} />}
          {b.quote && (
            <p className={styles.ok}>
              {b.quote.status === 'partially_accepted'
                ? t(b.quote.decided_by === 'shop' ? 'sb.detail.approvedPartialAtShop' : 'sb.detail.approvedPartial', {
                    n: b.quote.items.filter((i) => i.approved).length,
                    total: b.quote.items.length,
                    amount: formatMoney(lang, b.quote.total_approved ?? 0),
                  })
                : t(b.quote.decided_by === 'shop' ? 'sb.detail.approvedAtShop' : 'sb.detail.approved', {
                    amount: formatMoney(lang, b.quote.total_approved ?? b.quote.total_sent),
                  })}{' '}
              {t('sb.detail.approvedNext')}
            </p>
          )}
        </>
      );
    case 'in_progress':
      return (
        <>
          {b.quote && <QuoteLines quote={b.quote} />}
          <p className={styles.muted}>{t('sb.detail.inProgress', { since: at(b.started_at) })}</p>
        </>
      );
    default:
      return null;
  }
}
