import type { ReactNode } from 'react';
import styles from './BottomBar.module.css';

/**
 * The screen's main action ("Continuă", "Programează-te", "Trimite cererea"), always at the bottom
 * just above the menu: at the foot of a short screen and fixed there while a long one scrolls under
 * it. The screen's root needs `data-fill-screen` (it then fills the content area, AppShell).
 */
export function BottomBar({ children }: { children: ReactNode }) {
  return <div className={styles.bar}>{children}</div>;
}
