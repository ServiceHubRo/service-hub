import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './Disclosure.module.css';

/**
 * A section that opens and closes (the premium dropdown UI, Eduard 6 Nov 2026): a quiet row with a
 * title, an optional summary on the right and a small chevron; the content fades in under it. Built
 * on `<details>`, so it works with the keyboard and a screen reader without any script.
 */
export function Disclosure({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className={styles.disclosure} open={defaultOpen || undefined}>
      <summary className={styles.summary}>
        <span className={styles.title}>{title}</span>
        {summary !== undefined && <span className={styles.meta}>{summary}</span>}
        <ChevronDown size={18} className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.content}>{children}</div>
    </details>
  );
}

/** Disclosures one under the other, separated by hairlines, in one quiet block. */
export function DisclosureGroup({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className={styles.group} role={label ? 'group' : undefined} aria-label={label}>
      {children}
    </div>
  );
}
