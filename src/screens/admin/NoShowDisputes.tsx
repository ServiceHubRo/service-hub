import { UserX } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button';
import { DetailPane } from '../../components/ListDetailLayout';
import {
  decideNoShowDispute,
  type AdminNoShowDispute,
  type NoShowDecision,
} from '../../data/noShows';
import { useI18n } from '../../i18n/context';
import { formatDate } from '../../i18n/format';
import { ConfirmPanel } from './ActionPanels';
import { Pill } from './parts';
import { adminBookingPath, adminClientPath, adminShopPath } from './paths';
import { dateTime, disputeLine } from './format';
import styles from './admin.module.css';

/** The booking, the shop, the client and what the client wrote. */
function DisputeBody({ d }: { d: AdminNoShowDispute }) {
  const { t, lang } = useI18n();
  const b = d.booking;
  const c = d.client;
  const car = b ? [[b.car_snapshot?.make, b.car_snapshot?.model].filter(Boolean).join(' '), b.car_snapshot?.plate].filter(Boolean).join(' · ') : '';
  return (
    <>
      {b && (
        <span className={styles.rowMeta}>
          <Link className={styles.link} to={adminBookingPath(b.id)}>
            {b.ref}
          </Link>
          <Link className={styles.link} to={adminShopPath(b.shop_id)}>
            {b.shop_name}
            {b.shop_city ? `, ${b.shop_city}` : ''}
          </Link>
        </span>
      )}
      {b && (
        <span className={styles.muted}>
          {[`${formatDate(lang, b.date)}, ${b.slot}`, lang === 'en' ? b.service_en : b.service_ro, car].filter(Boolean).join(' · ')}
          {' · '}
          {t('admin.noShowDispute.markedAt', { date: dateTime(lang, b.status_changed_at) })}
        </span>
      )}
      {c && (
        <span className={`${styles.rowMeta} ${styles.rowMetaCentered}`}>
          <Link className={styles.link} to={adminClientPath(c.id)}>
            {c.name || t('admin.deletedAccount')}
            {c.display_id ? ` · ${c.display_id}` : ''}
          </Link>
          <span className={styles.muted}>{t('admin.noShowDispute.counts', { n: c.no_shows, d: c.disputes })}</span>
        </span>
      )}
      <p className={styles.quote}>{d.reason}</p>
      <span className={styles.muted}>{t('admin.noShowDispute.sentAt', { date: dateTime(lang, d.created_at) })}</span>
    </>
  );
}

/**
 * A dispute in detail (T53): the booking, the shop, the client's count and what the client wrote.
 * A waiting one is decided here: "Anulează neprezentarea" (it no longer counts) or "Menține
 * neprezentarea"; the note stays internal; the client is told.
 */
export function DisputeDetail({ d, notice, onDecided }: { d: AdminNoShowDispute; notice: string | null; onDecided: () => void }) {
  const { t, lang } = useI18n();
  const [panel, setPanel] = useState<NoShowDecision | null>(null);
  const pending = d.status === 'pending';
  return (
    <DetailPane
      id={d.id}
      icon={<UserX size={20} />}
      title={d.booking?.shop_name ?? t('admin.noShowDispute.title', { n: 1 })}
      detail={disputeLine(t, lang, d)}
      status={<Pill tone={pending ? 'amber' : d.status === 'upheld' ? 'green' : 'grey'}>{t(`admin.noShowDispute.status.${d.status}`)}</Pill>}
      message={notice ? { tone: 'success', text: notice } : undefined}
      panel={
        pending && panel !== null ? (
          <ConfirmPanel
            title={t(panel === 'upheld' ? 'admin.noShowDispute.upholdTitle' : 'admin.noShowDispute.rejectTitle')}
            body={t(panel === 'upheld' ? 'admin.noShowDispute.upholdBody' : 'admin.noShowDispute.rejectBody')}
            textLabel={t('admin.moderation.note')}
            textHint={t('admin.moderation.noteHint')}
            confirmLabel={t(panel === 'upheld' ? 'admin.noShowDispute.uphold' : 'admin.noShowDispute.reject')}
            onConfirm={async (note, requestId) => {
              await decideNoShowDispute(d.id, panel, note, requestId);
              onDecided();
            }}
            onCancel={() => setPanel(null)}
          />
        ) : undefined
      }
      actions={
        pending ? (
          <>
            <Button variant="success" onClick={() => setPanel('upheld')}>
              {t('admin.noShowDispute.uphold')}
            </Button>
            <Button variant="secondary" onClick={() => setPanel('rejected')}>
              {t('admin.noShowDispute.reject')}
            </Button>
          </>
        ) : undefined
      }
    >
      <DisputeBody d={d} />
      {!pending && d.decided_at && (
        <p className={styles.muted}>
          {dateTime(lang, d.decided_at)}
          {d.decided_by ? ` · ${d.decided_by}` : ''}
        </p>
      )}
      {d.decision_note && (
        <p className={styles.muted}>
          {t('admin.moderation.noteShown')}: {d.decision_note}
        </p>
      )}
    </DetailPane>
  );
}
