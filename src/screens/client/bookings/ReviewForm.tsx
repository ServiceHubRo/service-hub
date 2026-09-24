import { Star } from 'lucide-react';
import { useId, useState } from 'react';
import { ActionButton } from '../../../components/ActionButton';
import { Button } from '../../../components/Button';
import { InlinePanel } from '../../../components/InlinePanel';
import { TextArea } from '../../../components/TextArea';
import { canRetryRpc, rpcErrorMessage, submitReview, toRpcError, type Review } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import styles from './bookings.module.css';

const REVIEW_MAX = 2000;

/**
 * The review form inside a finished booking's card (P10, P10b): five tappable stars, optional
 * text, send / cancel. One review per booking, within the window after completion; the database
 * refuses a second one and anything late.
 */
export function ReviewForm({
  bookingId,
  shopName,
  onSent,
  onStale,
  onClose,
}: {
  bookingId: string;
  shopName: string;
  onSent: (review: Review) => void;
  /** The booking changed meanwhile (a review already sent from another device). */
  onStale: () => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();
  const errorId = useId();

  async function send(requestId: string) {
    if (rating < 1) {
      setError(t('cb.review.pick'));
      return;
    }
    try {
      onSent(await submitReview(bookingId, rating, text.trim() || undefined, requestId));
    } catch (e) {
      const code = toRpcError(e).code;
      if (code === 'review_exists' || code === 'wrong_status' || code === 'booking_not_found') onStale();
      throw e;
    }
  }

  return (
    <InlinePanel title={t('cb.review.title', { shop: shopName })}>
      <div className={styles.rating}>
        <span id={labelId} className={styles.ratingLabel}>
          {t('cb.review.rating')}
        </span>
        <div
          className={styles.stars}
          role="group"
          aria-labelledby={labelId}
          aria-describedby={error ? errorId : undefined}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={`${styles.star} ${n <= rating ? styles.starOn : ''}`}
              aria-pressed={n === rating}
              aria-label={t('cb.review.star', { n })}
              onClick={() => {
                setRating(n);
                setError(null);
              }}
            >
              <Star size={28} aria-hidden="true" />
            </button>
          ))}
        </div>
        {error && (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
      <TextArea
        label={t('cb.review.text')}
        hint={t('cb.review.hint')}
        value={text}
        maxLength={REVIEW_MAX}
        rows={3}
        onChange={(e) => setText(e.target.value)}
      />
      <div className={styles.buttons}>
        <ActionButton block={false} onAction={send} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
          {t('cb.review.submit')}
        </ActionButton>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </InlinePanel>
  );
}
