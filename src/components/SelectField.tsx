import { ChevronDown } from 'lucide-react';
import { useId, type SelectHTMLAttributes } from 'react';
import { useTouchSelect } from '../lib/touchSelect';
import styles from './Field.module.css';

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: string;
  options: { value: string; label: string }[];
  /** Options under headings (`<optgroup>`), after `options`. */
  groups?: { label: string; options: { value: string; label: string }[] }[];
}

/** Label + native select (the phone's own picker) + hint. Lets go of the focus after a tap choice (useTouchSelect). */
export function SelectField({ label, hint, options, groups, className, onChange, ...rest }: SelectFieldProps) {
  const id = useId();
  const touch = useTouchSelect(onChange);
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={`${styles.field} ${className ?? ''}`}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.selectWrap}>
        <select id={id} className={`${styles.input} ${styles.select}`} aria-describedby={hintId} {...rest} {...touch}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {groups?.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown size={18} className={styles.selectIcon} aria-hidden="true" />
      </div>
      {hint && (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      )}
    </div>
  );
}
