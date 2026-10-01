import { BadgePercent } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './OfferNote.module.css';

/**
 * A shop's new-client offer (T23), the same everywhere it shows: the percent icon and one line.
 * `compact` is the search card's version, without the box.
 */
export function OfferNote({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return (
    <span className={`${styles.note} ${compact ? styles.compact : ''}`}>
      <BadgePercent size={compact ? 14 : 17} className={styles.icon} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
