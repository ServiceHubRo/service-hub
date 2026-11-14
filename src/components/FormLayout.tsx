import type { FormEvent, ReactNode } from 'react';
import styles from './FormLayout.module.css';

/**
 * Page template C, a form (Eduard, 14 Nov 2026): one column of at most --form-max, centered, its
 * title above it; sections with a title; two fields on one row only when they belong together
 * (FieldPair). The save bar is as wide as the form and stays at the bottom while the form scrolls
 * (put back in the page while the phone's keyboard is open, global.css). Enter in a field submits.
 */
export function FormLayout({
  header,
  onSubmit,
  save,
  aside,
  children,
}: {
  /** The page's PageHeader: at the form's left edge, not the screen's. */
  header: ReactNode;
  /** Usually nothing: the save button is an ActionButton `submit`. */
  onSubmit?: () => void;
  /** The main action (one filled button). */
  save: ReactNode;
  /** A quiet action beside it („Renunță”). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      {header}
      <form
        className={styles.form}
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit?.();
        }}
      >
        {children}
        <div className={styles.bar} data-fixed-bottom>
          {aside && <div className={styles.aside}>{aside}</div>}
          <div className={styles.save}>{save}</div>
        </div>
      </form>
    </div>
  );
}

/** A part of a form: its title, one sentence when it helps, its fields on one shade. */
export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {description && <p className={styles.sectionText}>{description}</p>}
      </div>
      <div className={styles.fields}>{children}</div>
    </section>
  );
}

/** Two fields that belong together on one row (make and model, day and time), on every width. */
export function FieldPair({ children }: { children: ReactNode }) {
  return <div className={styles.pair}>{children}</div>;
}

/** A form loading (the item to edit): its sections, the same shape. */
export function FormSkeleton({ sections = 2, label }: { sections?: number; label: string }) {
  return (
    <div className={styles.form} aria-busy="true" role="status">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: sections }, (_, i) => (
        <div key={i} className={styles.section} aria-hidden="true">
          <span className={`${styles.bone} ${styles.boneTitle}`} />
          <div className={styles.fields}>
            {[0, 1, 2].map((f) => (
              <span key={f} className={`${styles.bone} ${styles.boneField}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
