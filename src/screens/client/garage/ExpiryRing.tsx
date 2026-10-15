import type { CSSProperties } from 'react';
import type { Urgency } from '../../../lib/expiry';
import { motionOn } from '../../../lib/motion';
import styles from './garage.module.css';

/** A year is a full ring; less time left, less ring. */
const FULL_DAYS = 365;

/**
 * How much time a document has left, at a glance (Eduard, 15 Oct): green while there is time,
 * amber in the last 30 days, a full red ring once expired; the days left in the middle when they
 * fit. It fills up when the Garage opens (src/lib/motion.ts, expiryRings). Decoration: the words
 * under it say the same. No date set: an empty grey ring.
 */
export function ExpiryRing({ days, urgency }: { days: number | null; urgency: Urgency | null }) {
  const left = days === null || urgency === null ? 0 : urgency === 'expired' ? 1 : Math.max(0.04, Math.min(1, days / FULL_DAYS));
  const middle = days === null || urgency === null ? '' : urgency === 'expired' ? '!' : days <= 99 ? String(days) : '';
  return (
    <span className={`${styles.ring} ${urgency ? styles[`ring_${urgency}`] : ''}`} aria-hidden="true">
      <svg
        className={motionOn('expiryRings') ? styles.ringFill : undefined}
        width={44}
        height={44}
        viewBox="0 0 44 44"
        focusable="false"
      >
        <path className={styles.ringTrack} d="M22 3.5a18.5 18.5 0 1 1 0 37a18.5 18.5 0 1 1 0-37" />
        {left > 0 && (
          <path
            className={styles.ringArc}
            d="M22 3.5a18.5 18.5 0 1 1 0 37a18.5 18.5 0 1 1 0-37"
            pathLength={1}
            style={{ '--left': 1 - left } as CSSProperties}
          />
        )}
      </svg>
      {middle && <span className={styles.ringDays}>{middle}</span>}
    </span>
  );
}
