import type { ComponentProps, ReactNode } from 'react';
import styles from './Checkbox.module.css';

export interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type'> {
  children: ReactNode;
  /** Some but not all of what it stands for is ticked: a dash, read as "mixed". */
  indeterminate?: boolean;
}

/** A real checkbox (keyboard and screen reader friendly) with the amber box look. */
export function Checkbox({ children, className, indeterminate = false, ...rest }: CheckboxProps) {
  return (
    <label className={`${styles.row} ${className ?? ''}`}>
      <input
        type="checkbox"
        className={styles.input}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        {...rest}
      />
      <span className={styles.box} aria-hidden="true" />
      <span className={styles.text}>{children}</span>
    </label>
  );
}
