import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import styles from './Field.module.css';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
  /** Plates, phones, prices, km. */
  mono?: boolean;
  /** Shown in capitals as typed (plates, VIN); the caller stores the upper-case value. */
  upper?: boolean;
  /** A small button inside the input, on the right (e.g. show password). */
  end?: ReactNode;
}

/** Label + input + hint/error, tied together for screen readers. */
export function Field({ label, hint, error, mono, upper, end, className, ...rest }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={`${styles.field} ${className ?? ''}`}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={end ? styles.withEnd : undefined}>
        <input
          id={id}
          className={`${styles.input} ${mono ? 'mono' : ''} ${upper ? styles.upper : ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          {...rest}
        />
        {end && <div className={styles.end}>{end}</div>}
      </div>
      {hint && !error && (
        <span id={hintId} className={styles.hint}>
          {hint}
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
