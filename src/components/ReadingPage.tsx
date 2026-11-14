import type { ReactNode } from 'react';
import styles from './ReadingPage.module.css';

/**
 * Page template E, a page to read (help, procedures, legal documents, notices; Eduard 14 Nov 2026):
 * one column of at most 72 characters a line, its title at the same left edge. Paragraphs, headings
 * and lists inside take the reading sizes and spacing.
 */
export function ReadingPage({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.page}>
      {header}
      <div className={styles.body}>{children}</div>
    </div>
  );
}

/** A page to read, loading: lines of text of the same measure. */
export function ReadingSkeleton({ label }: { label: string }) {
  return (
    <div className={styles.body} aria-busy="true" role="status">
      <span className="visually-hidden">{label}</span>
      {['w90', 'w100', 'w70', 'w40', 'w100', 'w80'].map((w, i) => (
        <span key={i} className={`${styles.bone} ${styles[w]}`} aria-hidden="true" />
      ))}
    </div>
  );
}
