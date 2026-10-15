import type { CSSProperties } from 'react';
import { motionOn } from '../lib/motion';
import type { BookingStatus } from '../lib/status';
import styles from './BookingProgress.module.css';

/** The road of a booking: sent, confirmed, inspection, quote, work, ready. */
const STEP: Partial<Record<BookingStatus, number>> = {
  pending: 0,
  confirmed: 1,
  in_inspection: 2,
  quote_sent: 3,
  approved: 3,
  in_progress: 4,
  done: 5,
};
const LAST = 5;

/** How far along the road a booking is, or null when it left the road (refused, canceled, ...). */
function progressStep(status: BookingStatus): number | null {
  return STEP[status] ?? null;
}

/**
 * A line with six points under the booking's status (Eduard, 15 Oct). When the status changes
 * while the screen is open, the line runs on to the new point and the point lights up
 * (src/lib/motion.ts, statusLine). Decoration: the status is said in words by the badge.
 */
export function BookingProgress({ status }: { status: BookingStatus }) {
  const step = progressStep(status);
  if (step === null) return null;
  return (
    <div
      className={`${styles.progress} ${motionOn('statusLine') ? styles.animated : ''}`}
      style={{ '--done': step / LAST } as CSSProperties}
      aria-hidden="true"
    >
      <span className={styles.track} />
      <span className={styles.fill} />
      {Array.from({ length: LAST + 1 }, (_, i) => (
        <span key={i} className={`${styles.point} ${i < step ? styles.passed : ''} ${i === step ? styles.current : ''}`} />
      ))}
    </div>
  );
}
