import { useEffect, useRef, type ReactNode } from 'react';
import { Card } from './Card';
import styles from './InlinePanel.module.css';

/**
 * A panel that opens inside a card instead of a dialog (ARCHITECTURE §17): cancelling, a quote
 * refusal, the review form, the shop's actions. Its title takes the focus when it opens, so
 * keyboard and screen-reader users land in it.
 */
export function InlinePanel({ title, children }: { title: string; children: ReactNode }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: false });
  }, []);
  return (
    <Card inset className={styles.panel}>
      <h3 ref={titleRef} tabIndex={-1} className={styles.title}>
        {title}
      </h3>
      {children}
    </Card>
  );
}
