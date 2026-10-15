import { motionOn } from '../lib/motion';
import styles from './SuccessCheck.module.css';

/**
 * A green check in a ring, drawn line by line when it appears (src/lib/motion.ts, successCheck):
 * shown next to the words that say what went through. Decoration only; the words carry the meaning.
 */
export function SuccessCheck({ size = 56 }: { size?: number }) {
  return (
    <svg
      className={`${styles.check} ${motionOn('successCheck') ? styles.animated : ''}`}
      width={size}
      height={size}
      viewBox="0 0 56 56"
      aria-hidden="true"
      focusable="false"
    >
      <path className={styles.disc} d="M28 4a24 24 0 1 1 0 48a24 24 0 1 1 0-48" />
      <path className={styles.ring} d="M28 4a24 24 0 1 1 0 48a24 24 0 1 1 0-48" pathLength={1} />
      <path className={styles.tick} d="M17 29l7 7l15-15" pathLength={1} />
    </svg>
  );
}
