import type { CSSProperties } from 'react';
import type { Urgency } from '../../../lib/expiry';
import { motionOn } from '../../../lib/motion';
import styles from './garage.module.css';

/** A year is a full ring; less time left, less ring. */
const FULL_DAYS = 365;

/**
 * How much time a document has left, at a glance (Eduard, 15 Oct): green while there is time,
 * amber in the last 30 days, a full red ring once expired. It fills up when the Garage opens
 * (src/lib/motion.ts, expiryRings). Decoration: the words next to it say the same.
 */
export function ExpiryRing({ days, urgency }: { days: number; urgency: Urgency }) {
  const left = urgency === 'expired' ? 1 : Math.max(0.04, Math.min(1, days / FULL_DAYS));
  return (
    <svg
      className={`${styles.ring} ${styles[`ring_${urgency}`]} ${motionOn('expiryRings') ? styles.ringFill : ''}`}
      width={18}
      height={18}
      viewBox="0 0 22 22"
      aria-hidden="true"
      focusable="false"
    >
      <path className={styles.ringTrack} d="M11 2a9 9 0 1 1 0 18a9 9 0 1 1 0-18" />
      <path
        className={styles.ringArc}
        d="M11 2a9 9 0 1 1 0 18a9 9 0 1 1 0-18"
        pathLength={1}
        style={{ '--left': 1 - left } as CSSProperties}
      />
    </svg>
  );
}
