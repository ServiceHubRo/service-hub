import { useId, type TextareaHTMLAttributes } from 'react';
import styles from './Field.module.css';

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string;
  /** How much is written, e.g. „15 / 4.000”: on the hint's line at the right, never split (Eduard, 11 Nov 2026). */
  count?: string;
  error?: string | null;
}

/** Label + multi-line input + hint/error, styled like Field. */
export function TextArea({ label, hint, count, error, className, ...rest }: TextAreaProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const countId = count ? `${id}-count` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={`${styles.field} ${className ?? ''}`}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <textarea
        id={id}
        className={`${styles.input} ${styles.textarea}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, countId, errorId].filter(Boolean).join(' ') || undefined}
        {...rest}
      />
      {(hint || count) && !error && (
        <span className={styles.hintRow}>
          {hint && (
            <span id={hintId} className={styles.hint}>
              {hint}
            </span>
          )}
          {count && (
            <span id={countId} className={styles.count} data-count>
              {count}
            </span>
          )}
        </span>
      )}
      {error && (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
