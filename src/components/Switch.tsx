import type { ComponentProps, ReactNode } from 'react';
import styles from './Switch.module.css';

export interface SwitchProps extends Omit<ComponentProps<'input'>, 'type' | 'role'> {
  children: ReactNode;
  /** A line under the label (what on and off mean). */
  hint?: ReactNode;
}

/**
 * On / off (Eduard, 9 Oct: switches instead of rows of buttons): a real checkbox announced as a
 * switch, the label on the left, the track on the right; the whole row is the tap target.
 */
export function Switch({ children, hint, className, ...rest }: SwitchProps) {
  return (
    <label className={`${styles.row} ${className ?? ''}`}>
      <span className={styles.text}>
        <span className={styles.label}>{children}</span>
        {hint && <span className={styles.hint}>{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className={styles.input} {...rest} />
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
    </label>
  );
}
