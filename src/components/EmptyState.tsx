import type { LucideIcon } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { motionOn } from '../lib/motion';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}

/**
 * Shown only after data has loaded and is empty. The icon is a small line drawing in a ring, and
 * draws itself when the screen opens (src/lib/motion.ts, emptyDrawings).
 */
export function EmptyState({ icon: Icon, title, body, action }: EmptyStateProps) {
  const art = useRef<HTMLSpanElement>(null);
  // Every line of the icon counts as length 1, so short and long ones draw at the same pace as
  // the ring (with real lengths the short ones only showed in the last moment, all at once).
  useLayoutEffect(() => {
    art.current?.querySelectorAll(`.${styles.icon} > *`).forEach((el) => el.setAttribute('pathLength', '1'));
  }, [Icon]);
  return (
    <div className={styles.empty}>
      {Icon && (
        <span ref={art} className={`${styles.art} ${motionOn('emptyDrawings') ? styles.draw : ''}`} aria-hidden="true">
          <svg className={styles.orbit} viewBox="0 0 80 80" focusable="false">
            <path d="M40 3a37 37 0 1 1 0 74a37 37 0 1 1 0-74" pathLength={1} />
          </svg>
          <Icon size={34} strokeWidth={1.6} className={styles.icon} />
        </span>
      )}
      <p className={styles.title}>{title}</p>
      {body && <p className={styles.body}>{body}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
