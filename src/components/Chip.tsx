import type { ReactNode } from 'react';
import styles from './Chip.module.css';

export interface ChipProps {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

export function Chip({ selected = false, onClick, children }: ChipProps) {
  return (
    <button type="button" className={`${styles.chip} ${selected ? styles.on : ''}`} aria-pressed={selected} onClick={onClick}>
      {children}
    </button>
  );
}

/** Horizontal, scrollable row of chips. */
export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className={styles.row} role="group" aria-label={label}>
      {children}
    </div>
  );
}
