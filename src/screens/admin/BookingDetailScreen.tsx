import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { Stars } from '../../components/Stars';
import { StatusBadge } from '../../components/StatusBadge';
import { fetchBooking, type AdminQuote } from '../../data/admin';
import { adminForceCancel, toRpcError } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { formatKm } from '../../i18n/format';
import type { MessageKey } from '../../i18n/ro';
import { NO_SHOW_FLAG } from '../../lib/admin';
import { isActiveStatus } from '../../lib/status';
import { formatPhone } from '../../lib/validators';
import { ConfirmPanel } from './ActionPanels';
import { Conversation } from './Conversation';
import { AuditList, Facts, Money, Pill, SectionTitle } from './parts';
import { ADMIN_BOOKINGS_PATH, adminClientPath, adminShopPath, adminThreadPath } from './paths';
import { useLiveData } from './useLiveData';
import { carText, dateTime, day } from './format';
import styles from './admin.module.css';

function QuoteCard({ q }: { q: AdminQuote }) {
  const { t, lang } = useI18n();
  const decided = q.items.some((i) => i.approved !== null);
  return (
    <Card className={styles.stack}>
      <div className={styles.rowTop}>
        <span className={styles.rowTitle}>{t('admin.booking.quote', { n: q.version })}</span>
        <Pill tone={q.status === 'accepted' || q.status === 'partially_accepted' ? 'green' : q.status === 'sent' ? 'amber' : 'grey'}>
          {t(`admin.quoteStatus.${q.status}` as MessageKey)}
        </Pill>
        <span className={styles.muted}>{dateTime(lang, q.sent_at)}</span>
      </div>
      <ul className={styles.lines}>
        {q.items.map((i) => (
          <li key={i.id} className={`${styles.line} ${decided && i.approved === false ? styles.lineRefused : ''}`}>
            <span>
              {i.name}
              {decided && i.approved === false && <span className="visually-hidden"> ({t('admin.booking.lineRefused')})</span>}
            </span>
            <Money amount={i.price} />
          </li>
        ))}
      </ul>
      <Facts
        rows={[
          [t('admin.booking.totalSent'), <Money key="s" amount={q.total_sent} />],
          [t('admin.booking.totalApproved'), q.total_approved === null ? null : <Money key="a" amount={q.total_approved} />],
          [t('admin.booking.fee'), <Money key="f" amount={q.inspection_fee} />],
          [t('admin.booking.expires'), q.expires_at ? dateTime(lang, q.expires_at) : null],
          [t('admin.booking.decided'), q.decided_at ? dateTime(lang, q.decided_at) : null],
          [t('admin.booking.note'), q.note],
        ]}
      />
    </Card>
  );
}

/**
 * One booking for the admin (FR §5.4, P20): who, what, when, every step with its time, every quote
 * version with its lines, the work done, the review and the whole conversation; force-cancel with
 * a reason (both sides are told) while it is active. Live.
 */
export function BookingDetailScreen() {
  const { bookingId = '' } = useParams();
  const { t, lang } = useI18n();
  const load = useCallback(() => fetchBooking(bookingId), [bookingId]);
  const { state, reload, refetch } = useLiveData(load, [{ table: 'bookings', filter: `id=eq.${bookingId}` }], `admin-booking:${bookingId}`);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (state.status === 'loading') return <SkeletonList />;
  if (state.status === 'error') {
    return (
      <div className={styles.page}>
        <BackLink to={ADMIN_BOOKINGS_PATH} label={t('nav.admin.bookings')} />
        <LoadError
          message={toRpcError(state.error).code === 'booking_not_found' ? t('admin.booking.notFound') : t('admin.loadError')}
          onRetry={reload}
        />
      </div>
    );
  }
  const d = state.data;
  const b = d.booking;
  const service = d.service ? (lang === 'ro' ? d.service.name_ro : d.service.name_en) : '';
  const clientName = b.client_name || d.client?.name || t('admin.deletedAccount');

  return (
    <div className={styles.page}>
      <BackLink to={ADMIN_BOOKINGS_PATH} label={t('nav.admin.bookings')} />

      <Card className={styles.stack}>
        <div className={styles.cardHead}>
          <h1 className={styles.cardTitle}>{service}</h1>
          <StatusBadge status={b.status} />
        </div>
        <span className={styles.rowMeta}>
          <span className={styles.id}>{b.ref}</span>
          <span>
            {day(lang, b.date)}, {b.slot}
          </span>
        </span>
        <Facts
          rows={[
            [
              t('admin.booking.shop'),
              d.shop ? (
                <Link className={styles.link} to={adminShopPath(d.shop.id)}>
                  {d.shop.name}, {d.shop.city}
                </Link>
              ) : null,
            ],
            [
              t('admin.booking.client'),
              d.client ? (
                <Link className={styles.link} to={adminClientPath(d.client.id)}>
                  {clientName} · {d.client.display_id}
                </Link>
              ) : (
                clientName
              ),
            ],
            [t('admin.phone'), b.client_phone ? <span className="mono">{formatPhone(b.client_phone)}</span> : null],
            [t('admin.email'), d.client?.email],
            [t('admin.booking.car'), [carText(b.car_snapshot), b.car_snapshot.plate].filter(Boolean).join(' · ')],
            [t('admin.client.vin'), b.car_snapshot.vin ? <span className="mono">{b.car_snapshot.vin}</span> : null],
            [t('admin.booking.clientNote'), b.note],
          ]}
        />
        {d.client && d.client.no_shows >= NO_SHOW_FLAG && <p className={styles.warning}>{t('admin.noShowFlag', { n: d.client.no_shows })}</p>}
      </Card>

      {notice && (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      )}

      {isActiveStatus(b.status) &&
        (cancelling ? (
          <ConfirmPanel
            title={t('admin.booking.forceCancel')}
            body={t('admin.booking.forceCancelBody')}
            textLabel={t('admin.booking.cancelReason')}
            textHint={t('admin.booking.cancelReasonHint')}
            textRequired
            confirmLabel={t('admin.booking.forceCancel')}
            danger
            onConfirm={async (reason, requestId) => {
              await adminForceCancel(b.id, reason, requestId);
              setCancelling(false);
              setNotice(t('admin.done.cancelled'));
              void refetch().catch(() => {});
            }}
            onCancel={() => setCancelling(false)}
          />
        ) : (
          <div className={styles.actions}>
            <Button variant="danger" onClick={() => setCancelling(true)}>
              {t('admin.booking.forceCancel')}
            </Button>
          </div>
        ))}

      <SectionTitle>{t('admin.booking.timeline')}</SectionTitle>
      <Card>
        <Facts
          rows={[
            [t('admin.booking.created'), dateTime(lang, b.created_at)],
            [t('status.confirmed'), b.confirmed_at ? dateTime(lang, b.confirmed_at) : null],
            [t('status.in_inspection'), b.inspection_started_at ? dateTime(lang, b.inspection_started_at) : null],
            [t('status.in_progress'), b.started_at ? dateTime(lang, b.started_at) : null],
            [t('status.done'), b.done_at ? dateTime(lang, b.done_at) : null],
            [t('status.cancelled'), b.cancelled_at ? dateTime(lang, b.cancelled_at) : null],
            [t('admin.booking.cancelledBy'), b.cancelled_by ? t(`admin.booking.by.${b.cancelled_by}`) : null],
            [t('admin.booking.cancelReason'), b.cancel_reason],
            [t('admin.booking.declineReason'), b.decline_reason],
          ]}
        />
      </Card>

      {d.quotes.length > 0 && (
        <>
          <SectionTitle>{t('admin.booking.quotes')}</SectionTitle>
          <ul className={styles.list}>
            {d.quotes.map((q) => (
              <li key={q.id}>
                <QuoteCard q={q} />
              </li>
            ))}
          </ul>
        </>
      )}

      {(b.work || b.cost !== null || b.odometer !== null) && (
        <>
          <SectionTitle>{t('admin.booking.work')}</SectionTitle>
          <Card>
            <Facts
              rows={[
                [t('admin.booking.workDone'), b.work],
                [t('admin.booking.cost'), b.cost === null ? null : <Money key="c" amount={b.cost} />],
                [t('admin.booking.odometer'), b.odometer === null ? null : <span className="mono">{formatKm(lang, b.odometer)}</span>],
              ]}
            />
          </Card>
        </>
      )}

      {d.review && (
        <>
          <SectionTitle>{t('admin.booking.review')}</SectionTitle>
          <Card className={styles.stack}>
            <div className={styles.rowTop}>
              <Stars value={d.review.rating} size={15} />
              <span className={styles.muted}>{day(lang, d.review.created_at)}</span>
              {d.review.removed_at ? (
                <Pill tone="grey">{t('admin.reportStatus.removed')}</Pill>
              ) : d.review.report_status ? (
                <Pill tone="amber">{t(`admin.reportStatus.${d.review.report_status}`)}</Pill>
              ) : null}
            </div>
            {d.review.text && <p className={styles.quote}>{d.review.text}</p>}
            {d.review.reply && <p className={styles.reply}>{d.review.reply}</p>}
          </Card>
        </>
      )}

      <SectionTitle>{t('admin.booking.conversation')}</SectionTitle>
      <Conversation messages={d.messages} shopName={d.shop?.name ?? ''} clientName={clientName} />
      {d.thread_id && (
        <Link to={adminThreadPath(d.thread_id)} className={styles.link}>
          {t('admin.booking.openThread')}
        </Link>
      )}

      <SectionTitle>{t('admin.audit.title')}</SectionTitle>
      <AuditList entries={d.audit} />
    </div>
  );
}
