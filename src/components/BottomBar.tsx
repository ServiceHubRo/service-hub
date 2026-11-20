import type { ReactNode } from 'react';
import { useEmbedded } from '../lib/embedded';
import styles from './BottomBar.module.css';

/**
 * The screen's main action ("Continuă", "Programează-te", "Trimite cererea"), always at the bottom
 * just above the menu: at the foot of a short screen and fixed there while a long one scrolls under
 * it. The screen's root needs `data-fill-screen` (it then fills the content area, AppShell).
 */
export function BottomBar({ children }: { children: ReactNode }) {
  // In a panel beside a list (the shop page next to the search results, C9) it stays at the panel's foot.
  const embedded = useEmbedded();
  return (
    <div className={`${styles.bar} ${embedded ? styles.embedded : ''}`} data-fixed-bottom>
      {children}
    </div>
  );
}
