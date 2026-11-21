import { CalendarDays, Clock } from 'lucide-react';
import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { useI18n } from '../i18n/context';
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
  /** The input element (to focus it). */
  ref?: Ref<HTMLInputElement>;
  /** Label on the left, input on the right (a row of a section card). */
  inline?: boolean;
}

/** Label + input + hint/error, tied together for screen readers. */
export function Field({ label, hint, error, mono, upper, end, inline, className, ...rest }: FieldProps) {
  const id = useId();
  const { t } = useI18n();
  // A date or a time is drawn without the native look (Field.module.css): an empty one says what it is
  // and shows an icon (the Android app drew it blank).
  const when = rest.type === 'date' ? 'date' : rest.type === 'time' ? 'time' : null;
  const emptyWhen = when !== null && rest.value === '';
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div data-ui="field" className={`${styles.field} ${inline ? styles.inline : ''} ${className ?? ''}`}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={end ? styles.withEnd : when ? styles.whenWrap : undefined}>
        <input
          id={id}
          className={`${styles.input} ${mono ? 'mono' : ''} ${upper ? styles.upper : ''} ${emptyWhen ? styles.emptyWhen : ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          {...rest}
        />
        {end && <div className={styles.end}>{end}</div>}
        {when && emptyWhen && (
          <span className={styles.whenHint} aria-hidden="true">
            {t(when === 'date' ? 'field.pickDate' : 'field.pickTime')}
          </span>
        )}
        {when === 'date' && <CalendarDays size={18} className={styles.whenIcon} aria-hidden="true" />}
        {when === 'time' && <Clock size={18} className={styles.whenIcon} aria-hidden="true" />}
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
