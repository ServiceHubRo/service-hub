import { CalendarClock, ClipboardCheck, ClipboardList, FilePen, MessageSquare, Phone, Store } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { JobDocuments } from '../../../components/JobDocuments';
import type { JobDocKind } from '../../../data/jobDocs';
import { Button } from '../../../components/Button';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { DetailFacts, DetailPane, DetailSection, type DetailMessage } from '../../../components/ListDetailLayout';
import { MoreActions } from '../../../components/MoreActions';
import { ServiceIcon } from '../../../components/ServiceIcon';
import { BookingStatusPill } from '../../../components/StatusPill';
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
import { fetchVehicleFile, lastKnownOdometer, type VehicleFileJob } from '../../../data/vehicleFile';
import { useLoad } from '../../../lib/useLoad';
import { useI18n } from '../../../i18n/context';
import { plural } from '../../../i18n/translate';
import { daysFromToday, formatDate, formatDayMonth, formatKm, formatMoney, formatTime, ymdInBucharest } from '../../../i18n/format';
import { rowServicesText } from '../../../lib/bookingServices';
import { quoteTotal, slotStarted } from '../../../lib/shopBookings';
import { formatPhone, normalizePhone } from '../../../lib/validators';
import { ConfirmPanel, ReasonPanel } from './BookingPanels';
import { ClientAnswerPanel } from './ClientAnswerPanel';
import { CompletionPanel } from './CompletionPanel';
import { QuoteLines } from './QuoteLines';
import { ReschedulePanel } from './ReschedulePanel';
import { bookingMessagesPath } from '../../messages/paths';
import { intakePath, quoteEditorPath, vehicleFilePath } from '../paths';
import styles from './shopBookings.module.css';

type PanelKind = 'decline' | 'reschedule' | 'cancel' | 'noShow' | 'withdraw' | 'complete' | 'answer';

/** The statuses in which the car is at the shop and the intake sheet can be written (T50). */
const INTAKE_STATUSES = new Set(['confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress']);

/** The statuses with a line (and the quote) in the details: StatusDetail. */
const DETAIL_STATUSES = new Set(['in_inspection', 'quote_sent', 'approved', 'in_progress']);

/** From 3 no-shows in 90 days shops see a discreet line (ARCHITECTURE §6); no automatic block. */
const NO_SHOW_MARK = 3;

export interface ShopBookingDetailProps {
  booking: ShopBooking;
  shopId: string;
  /** The shop's name: „La …” over its own jobs on the car. */
  shopName: string;
  now: Date;
  /** An action went through: the booking as the database returned it. */
  onDone: (before: ShopBooking, after: Booking) => void;
  /** The booking changed under this detail (another device, the client): read the list again. */
  onStale: () => void;
  /** What stands above the content (the answer of an action, on a phone). */
  top?: ReactNode;
}

/**
 * One booking in the detail beside the list of the shop's Programări (page template A, P8, FR §4.2):
 * the client's phone, account id, note and no-show mark; the quote's lines; the intake sheet; the
 * PDFs. One main action in sight (the only filled button, P5), the rest behind „Mai multe”. Every
 * action opens in the detail (no dialogs) and goes through a database function; the buttons only
 * mirror what the database allows.
 */
export function ShopBookingDetail({ booking: b, shopId, shopName, now, onDone, onStale, top }: ShopBookingDetailProps) {
  const { t, lang } = useI18n();
  const offerText = useOfferText();
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const navigate = useNavigate();
  const started = slotStarted(b, now);
  // T53: a no-show only after the slot and the grace period (the database decides; this mirrors it).
  const noShowOpen = b.status === 'confirmed' && started && (!b.no_show_from || new Date(b.no_show_from) <= now);

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

  const amount = b.quote ? quoteTotal(b.quote) : null;
  const docs: JobDocKind[] = [...(b.quote ? (['quote'] as const) : []), ...(b.intake_sent_at ? (['intake'] as const) : [])];
  const hasClientFacts =
    !!phone || !!b.client_account || b.client_no_shows >= NO_SHOW_MARK || !!b.note || !!b.offer_percent || !!b.loyalty_percent || b.source === 'shop';

  const primary = (
    <>
          {/* One main action in sight; the rest behind "Mai multe" (Eduard, 10 Oct). */}
          {b.status === 'pending' && !started && (
            <ActionButton
              variant="primary"
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
            <Button variant="primary" onClick={() => navigate(quoteEditorPath(b.id))}>
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
              variant="primary"
              block={false}
              onAction={(rid) => act(() => startWork(b.id, rid))}
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              canRetry={canRetryRpc}
            >
              {t('sb.action.startWork')}
            </ActionButton>
          )}
          {b.status === 'in_progress' && (
            <Button variant="primary" onClick={() => setPanel('complete')}>
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
                    { key: 'editQuote', label: t('sb.action.editQuote'), icon: <FilePen size={18} aria-hidden="true" />, to: quoteEditorPath(b.id) },
                    { key: 'withdraw', label: t('sb.action.withdrawQuote'), onSelect: () => setPanel('withdraw'), danger: true },
                  ]
                : []),
              // A deleted client account has no conversation.
              ...(b.client_account
                ? [{ key: 'message', label: t('msg.button'), icon: <MessageSquare size={18} aria-hidden="true" />, to: bookingMessagesPath('shop', b.id) }]
                : []),
              ...(INTAKE_STATUSES.has(b.status)
                ? [{ key: 'intake', label: t('in.title'), icon: <ClipboardCheck size={18} aria-hidden="true" />, to: intakePath(b.id) }]
                : []),
              { key: 'file', label: t('vf.title'), icon: <ClipboardList size={18} aria-hidden="true" />, to: vehicleFilePath(b.id, 'bookings') },
              ...(noShowOpen
                ? [{ key: 'noShow', label: t('sb.action.noShow'), onSelect: () => setPanel('noShow') }]
                : []),
              ...(b.status === 'confirmed'
                ? [{ key: 'cancel', label: t('sb.action.cancel'), onSelect: () => setPanel('cancel'), danger: true }]
                : []),
            ]}
          />
    </>
  );

  return (
    <DetailPane
      id={b.id}
      icon={<ServiceIcon name={b.service_icon} size={20} />}
      title={service}
      detail={[`${formatDate(lang, b.date)}, ${b.slot}`, b.ref, car, plate, amount !== null ? formatMoney(lang, amount) : null].filter(Boolean).join(' · ')}
      status={<BookingStatusPill status={b.status} viewer="shop" />}
      message={statusMessage(b, started, noShowOpen, t, lang)}
      panel={
        panel !== null ? (
          <>
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
          </>
        ) : undefined
      }
      actions={primary}
    >
      {top}
      <BookingFacts booking={b} />
      <CarHistory booking={b} shopName={shopName} />
        <div className={`${styles.details} ${b.quote ? styles.split : ''}`}>
          {/* On a wide card the quote stands on the right, the rest on the left; on a narrow one all
              of it reads in one column, in this order: client, quote, intake sheet, documents. */}
          <div className={styles.detailsMain}>
            {hasClientFacts && (
              <Card inset className={styles.client}>
                {(phone || b.client_account || b.client_no_shows >= NO_SHOW_MARK) && (
                  <div className={styles.clientLine}>
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
                  </div>
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
            )}
            <IntakeLine booking={b} />
            {/* The documents read only: apart from the actions that move the job on. */}
            {docs.length > 0 && (
              <div className={styles.docs}>
                <p className={styles.groupLabel}>{t('doc.title')}</p>
                <JobDocuments bookingId={b.id} bookingRef={b.ref} quoteNumber={b.quote_number} kinds={docs} />
              </div>
            )}
          </div>
          {DETAIL_STATUSES.has(b.status) && (
            <div className={styles.detailsSide}>
              <StatusDetail booking={b} />
            </div>
          )}
        </div>
    </DetailPane>
  );
}

/** Why the main action is what it is, under the title: a request past its time, a visit past its slot. */
function statusMessage(
  b: ShopBooking,
  started: boolean,
  noShowOpen: boolean,
  t: ReturnType<typeof useI18n>['t'],
  lang: ReturnType<typeof useI18n>['lang'],
): DetailMessage | undefined {
  if (!started) return undefined;
  if (b.status === 'pending') return { tone: 'problem', text: t('sb.detail.pendingPast') };
  if (b.status === 'confirmed')
    return {
      tone: 'neutral',
      text: `${t('sb.detail.confirmedPast')}${!noShowOpen && b.no_show_from ? ` ${t('sb.detail.noShowFrom', { time: formatTime(lang, new Date(b.no_show_from)) })}` : ''}`,
    };
  return undefined;
}

/** What is known about the booking at a glance: the client, the car, when it was asked for. */
function BookingFacts({ booking: b }: { booking: ShopBooking }) {
  const { t, lang } = useI18n();
  const car = [b.car_snapshot.make, b.car_snapshot.model, b.car_snapshot.year].filter(Boolean).join(' ');
  return (
    <DetailFacts
      items={[
        { label: t('sb.facts.client'), value: b.client_name || t('sb.card.deletedClient') },
        { label: t('sb.facts.car'), value: car || t('sb.card.noCar') },
        ...(b.car_snapshot.plate ? [{ label: t('sb.facts.plate'), value: <span className="mono">{b.car_snapshot.plate}</span> }] : []),
        { label: t('sb.facts.asked'), value: `${formatDate(lang, ymdInBucharest(new Date(b.created_at)))}, ${formatTime(lang, new Date(b.created_at))}` },
      ]}
    />
  );
}

/** How many of the car's last jobs are listed here; the whole file is one tap away. */
const CAR_JOBS_SHOWN = 3;

/**
 * The car's recent history, read from its file (T27): the last jobs at this shop (with the work and the
 * odometer) and, when the client agreed, the last jobs at other shops — never a price or a shop name —
 * then the VIN and the last known odometer. „Fișa mașinii” has all of it.
 */
function CarHistory({ booking: b, shopName }: { booking: ShopBooking; shopName: string }) {
  const { t, lang } = useI18n();
  const load = useCallback(() => fetchVehicleFile(b.id), [b.id]);
  const { state, reload } = useLoad(load);
  if (state.status === 'loading') return <p className={styles.muted}>{t('common.loading')}</p>;
  if (state.status === 'error')
    return (
      <p className={styles.muted} role="alert">
        {t('vf.loadError')}{' '}
        <Button variant="ghost" onClick={reload}>
          {t('action.retry')}
        </Button>
      </p>
    );
  const file = state.data;
  const km = lastKnownOdometer(file);
  return (
    <DetailSection
      title={t('sb.history.title')}
      action={
        <Link className={buttonClass('secondary')} to={vehicleFilePath(b.id, 'bookings')}>
          {t('sb.history.all')}
        </Link>
      }
    >
      <DetailFacts
        items={[
          ...(file.car.vin ? [{ label: t('vf.vin'), value: <span className="mono">{file.car.vin}</span> }] : []),
          ...(km !== null ? [{ label: t('sb.history.km'), value: formatKm(lang, km) }] : []),
        ]}
      />
      <JobLines title={shopName ? t('vf.own', { shop: shopName }) : t('vf.ownFallback')} jobs={file.own} empty={t('vf.ownEmpty')} />
      <JobLines
        title={t('vf.others')}
        jobs={file.share === 'shared' ? file.others : []}
        empty={t(file.share === 'shared' ? 'vf.othersEmpty' : file.share === 'not_shared' ? 'vf.notShared' : 'vf.noActive')}
        note={file.share === 'shared' ? t('vf.othersNote') : undefined}
      />
    </DetailSection>
  );
}

/** The last few jobs of a list, one line each: day, services, odometer, and under it the work. */
function JobLines({ title, jobs, empty, note }: { title: string; jobs: (VehicleFileJob & { imported?: boolean })[]; empty: string; note?: string }) {
  const { t, lang } = useI18n();
  const shown = jobs.slice(0, CAR_JOBS_SHOWN);
  return (
    <div className={styles.carJobs}>
      <p className={styles.groupLabel}>
        {title}
        {jobs.length > 0 ? ` · ${plural(lang, 'unit.jobs', jobs.length)}` : ''}
      </p>
      {note && <p className={styles.muted}>{note}</p>}
      {shown.length === 0 ? (
        <p className={styles.muted}>{empty}</p>
      ) : (
        <ul className={styles.carJobList}>
          {shown.map((j) => (
            <li key={j.id}>
              <span>
                {formatDayMonth(lang, j.date)} · {j.imported ? t('imp.badge') : lang === 'ro' ? j.service_ro : j.service_en}
                {j.odometer !== null && <span className="mono"> · {formatKm(lang, j.odometer)}</span>}
              </span>
              {(j.work || j.items.length > 0) && <span className={styles.muted}>{j.work || j.items.join(', ')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the status means in the details (and the quote, once there is one). */
function StatusDetail({ booking: b }: { booking: ShopBooking }) {
  const { t, lang } = useI18n();
  /** `09:20`, or `Lun 13 oct, 09:20` when it was not today. */
  const at = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    const time = formatTime(lang, d);
    return daysFromToday(ymdInBucharest(d)) === 0 ? time : `${formatDate(lang, d)}, ${time}`;
  };

  switch (b.status) {
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

/** Where the intake sheet stands (T50), with a link to it while the car is at the shop. */
function IntakeLine({ booking: b }: { booking: ShopBooking }) {
  const { t } = useI18n();
  if (!INTAKE_STATUSES.has(b.status)) return null;
  const text = b.intake_confirmed_at ? t('in.line.confirmed') : b.intake_sent_at ? t('in.line.sent') : null;
  return (
    <p className={`${styles.muted} ${styles.intakeLine}`}>
      {text && <span>{text}</span>}
      <Link to={intakePath(b.id)} className={styles.inlineLink}>
        {b.intake_sent_at ? t('in.line.open') : t('in.line.write')}
      </Link>
    </p>
  );
}
