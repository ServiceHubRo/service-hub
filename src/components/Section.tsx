import { useId, type ReactNode } from 'react';
import styles from './Section.module.css';

export interface SectionProps {
  title: string;
  /** One short sentence under the title. */
  description?: string;
  /** Anchor for a link straight to this section (`#capacitate`). */
  id?: string;
  children: ReactNode;
}

/**
 * A group of settings (T51): on a desktop the title and its sentence on the left, the controls on
 * the right; on a phone the title above. Sections follow each other with a hairline between them, so
 * every page of settings has the same rhythm and the same left edge.
 */
export function Section({ title, description, id, children }: SectionProps) {
  const headingId = useId();
  return (
    <section id={id} className={styles.section} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          {title}
        </h2>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

/**
 * The card of a section: its settings one under the other, divided by hairlines, each one with its
 * label on the left and its control on the right (Switch, Stepper, an `inline` field).
 */
export function SectionCard({ children }: { children: ReactNode }) {
  return <div className={styles.card}>{children}</div>;
}
