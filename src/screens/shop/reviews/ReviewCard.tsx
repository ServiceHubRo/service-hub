import { useId, useState } from 'react';
import { ActionButton } from '../../../components/ActionButton';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { InlinePanel } from '../../../components/InlinePanel';
import { ShopAvatar } from '../../../components/ShopAvatar';
import { Stars } from '../../../components/Stars';
import { TextArea } from '../../../components/TextArea';
import type { ShopReview } from '../../../data/reviews';
import {
  canRetryRpc,
  replyReview,
  reportReview,
  rpcErrorMessage,
  toRpcError,
  type ReportReason,
} from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { formatDayMonth } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import styles from './reviews.module.css';

const REASONS: { value: ReportReason; label: MessageKey }[] = [
  { value: 'fake', label: 'reviews.reason.fake' },
  { value: 'abusive', label: 'reviews.reason.abusive' },
  { value: 'wrong_shop', label: 'reviews.reason.wrong_shop' },
  { value: 'personal_data', label: 'reviews.reason.personal_data' },
];

const MAX_REPLY = 2000;

export interface ReviewCardProps {
  review: ShopReview;
  /** A reply or report went through: the review as the database returned it. */
  onChanged: (review: Partial<ShopReview> & { id: string }) => void;
  /** The review changed under this card (removed, already reported): read the list again. */
  onStale: () => void;
}

/**
 * One review on the shop's Recenzii (P10): who, stars, date, text, the booking it is about; the
 * shop's public reply in a nested panel; "Răspunde" / "Editează răspunsul" and "Raportează" open
 * inside the card. A reported review keeps an amber border and "Raportată" until admin decides; it
 * stays public meanwhile.
 */
export function ReviewCard({ review: r, onChanged, onStale }: ReviewCardProps) {
  const { t, lang } = useI18n();
  const [panel, setPanel] = useState<'reply' | 'report' | null>(null);
  const [reply, setReply] = useState('');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [justReported, setJustReported] = useState(false);
  const groupName = useId();

  const name = r.client_display_name.trim() || t('reviews.deletedClient');
  const removed = r.removed_at !== null || r.report_status === 'removed';
  const pending = r.report_status === 'pending';
  const service = r.booking?.service ? (lang === 'ro' ? r.booking.service.name_ro : r.booking.service.name_en) : null;
  const about = [r.booking?.ref, service].filter(Boolean).join(' · ');

  async function act(run: () => Promise<Partial<ShopReview> & { id: string }>) {
    try {
      onChanged(await run());
    } catch (e) {
      const code = toRpcError(e).code;
      if (code === 'review_not_found' || code === 'already_reported') onStale();
      throw e;
    }
  }

  const replyText = reply.trim();
  const removingReply = r.reply !== null && replyText === '';

  return (
    <Card highlight={pending} className={`${styles.card} ${removed ? styles.removed : ''}`}>
      <div className={styles.top}>
        <ShopAvatar name={name} logoUrl={null} size={36} />
        <div className={styles.who}>
          <p className={styles.name}>{name}</p>
          <p className={styles.muted}>
            {formatDayMonth(lang, new Date(r.created_at))}
            {about && <span className="mono"> · {about}</span>}
          </p>
        </div>
        {pending && <span className={`${styles.pill} ${styles.pillAmber}`}>{t('reviews.reported')}</span>}
        {removed && <span className={`${styles.pill} ${styles.pillMuted}`}>{t('reviews.removed')}</span>}
      </div>
      {/* A block around the stars: as a flex item they would stretch and fill all five. */}
      <div>
        <Stars value={r.rating} size={16} />
      </div>
      {r.text && <p className={styles.text}>{r.text}</p>}

      {r.reply && panel !== 'reply' && (
        <Card inset className={styles.reply}>
          <p className={styles.replyLabel}>{t('reviews.yourReply')}</p>
          <p className={styles.text}>{r.reply}</p>
        </Card>
      )}

      {removed && <p className={styles.muted}>{t('reviews.removedBody')}</p>}
      {pending && <p className={styles.muted}>{justReported ? t('reviews.reportSent') : t('reviews.reportPending')}</p>}
      {r.report_status === 'kept' && <p className={styles.muted}>{t('reviews.reportKept')}</p>}

      {panel === null && !removed && (
        <div className={styles.actions}>
          <Button
            onClick={() => {
              setReply(r.reply ?? '');
              setPanel('reply');
            }}
          >
            {r.reply ? t('reviews.editReply') : t('reviews.reply')}
          </Button>
          {r.report_status === null && (
            <Button
              variant="ghost"
              onClick={() => {
                setReason(null);
                setPanel('report');
              }}
            >
              {t('reviews.report')}
            </Button>
          )}
        </div>
      )}

      {panel === 'reply' && (
        <InlinePanel title={r.reply ? t('reviews.editReply') : t('reviews.reply')}>
          <TextArea
            label={t('reviews.replyLabel')}
            hint={t('reviews.replyHint')}
            value={reply}
            maxLength={MAX_REPLY}
            rows={4}
            onChange={(e) => setReply(e.target.value)}
          />
          <div className={styles.buttons}>
            <ActionButton
              variant={removingReply ? 'danger' : 'primary'}
              block={false}
              disabled={replyText === '' && r.reply === null}
              onAction={(rid) =>
                act(async () => {
                  const saved = await replyReview(r.id, replyText, rid);
                  setPanel(null);
                  return saved as unknown as ShopReview;
                })
              }
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              canRetry={canRetryRpc}
            >
              {removingReply ? t('reviews.deleteReply') : t('reviews.publish')}
            </ActionButton>
            <Button variant="ghost" onClick={() => setPanel(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </InlinePanel>
      )}

      {panel === 'report' && (
        <InlinePanel title={t('reviews.reportTitle')}>
          <fieldset className={styles.reasons}>
            <legend className={styles.legend}>{t('reviews.reportLegend')}</legend>
            {REASONS.map((option) => (
              <label key={option.value} className={styles.radio}>
                <input
                  type="radio"
                  name={groupName}
                  value={option.value}
                  checked={reason === option.value}
                  onChange={() => setReason(option.value)}
                  className={styles.radioInput}
                />
                <span className={styles.radioDot} aria-hidden="true" />
                <span>{t(option.label)}</span>
              </label>
            ))}
          </fieldset>
          <p className={styles.muted}>{t('reviews.reportNote')}</p>
          <div className={styles.buttons}>
            <ActionButton
              variant="danger"
              block={false}
              disabled={reason === null}
              onAction={(rid) =>
                act(async () => {
                  const saved = await reportReview(r.id, reason!, rid);
                  setPanel(null);
                  setJustReported(true);
                  return saved as unknown as ShopReview;
                })
              }
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              canRetry={canRetryRpc}
            >
              {t('reviews.reportSubmit')}
            </ActionButton>
            <Button variant="ghost" onClick={() => setPanel(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </InlinePanel>
      )}
    </Card>
  );
}
