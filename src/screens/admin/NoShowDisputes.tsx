import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import {
  decideNoShowDispute,
  type AdminNoShowDispute,
  type AdminNoShowDisputes,
  type NoShowDecision,
} from '../../data/noShows';
import { useI18n } from '../../i18n/context';
import { formatDate } from '../../i18n/format';
import { ConfirmPanel } from './ActionPanels';
import { Pill, SectionTitle } from './parts';
import { adminBookingPath, adminClientPath, adminShopPath } from './paths';
import { dateTime } from './format';
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

function PendingCard({ d, onDecided }: { d: AdminNoShowDispute; onDecided: () => void }) {
  const { t } = useI18n();
  const [panel, setPanel] = useState<NoShowDecision | null>(null);
  return (
    <Card highlight className={styles.stack}>
      <div className={styles.rowTop}>
        <Pill tone="amber">{t('admin.noShowDispute.status.pending')}</Pill>
      </div>
      <DisputeBody d={d} />
      {panel === null ? (
        <div className={styles.panelButtons}>
          <Button variant="success" onClick={() => setPanel('upheld')}>
            {t('admin.noShowDispute.uphold')}
          </Button>
          <Button variant="secondary" onClick={() => setPanel('rejected')}>
            {t('admin.noShowDispute.reject')}
          </Button>
        </div>
      ) : (
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
      )}
    </Card>
  );
}

/**
 * Contestații la neprezentări (T53): the waiting ones first, oldest first, each with the booking,
 * the shop, the client's count and what the client wrote. "Anulează neprezentarea" (it no longer
 * counts) or "Menține neprezentarea"; the note stays internal; the client is told. Then the last
 * decided ones.
 */
export function NoShowDisputesSection({ data, onDecided }: { data: AdminNoShowDisputes; onDecided: () => void }) {
  const { t, lang } = useI18n();
  return (
    <>
      <SectionTitle>{t('admin.noShowDispute.title', { n: data.pending.length })}</SectionTitle>
      {data.pending.length === 0 ? (
        <p className={styles.muted}>{t('admin.noShowDispute.empty')}</p>
      ) : (
        <ul className={styles.list}>
          {data.pending.map((d) => (
            <li key={d.id}>
              <PendingCard d={d} onDecided={onDecided} />
            </li>
          ))}
        </ul>
      )}
      {data.decided.length > 0 && (
        <details className={styles.stack}>
          <summary className={styles.link}>{t('admin.noShowDispute.decided', { n: data.decided.length })}</summary>
          <ul className={styles.list}>
            {data.decided.map((d) => (
              <li key={d.id}>
                <Card className={styles.stack}>
                  <div className={styles.rowTop}>
                    <Pill tone={d.status === 'upheld' ? 'green' : 'grey'}>{t(`admin.noShowDispute.status.${d.status}`)}</Pill>
                    {d.decided_at && (
                      <span className={styles.muted}>
                        {dateTime(lang, d.decided_at)}
                        {d.decided_by ? ` · ${d.decided_by}` : ''}
                      </span>
                    )}
                  </div>
                  <DisputeBody d={d} />
                  {d.decision_note && (
                    <p className={styles.muted}>
                      {t('admin.moderation.noteShown')}: {d.decision_note}
                    </p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
