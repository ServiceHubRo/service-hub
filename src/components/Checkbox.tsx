import type { ComponentProps, ReactNode } from 'react';
import styles from './Checkbox.module.css';

export interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type'> {
  children: ReactNode;
}

/** A real checkbox (keyboard and screen reader friendly) with the amber box look. */
export function Checkbox({ children, className, ...rest }: CheckboxProps) {
  return (
    <label className={`${styles.row} ${className ?? ''}`}>
      <input type="checkbox" className={styles.input} {...rest} />
      <span className={styles.box} aria-hidden="true" />
      <span className={styles.text}>{children}</span>
    </label>
  );
}
