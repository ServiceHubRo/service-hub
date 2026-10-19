import { Check } from 'lucide-react';
import styles from './GuideMark.module.css';

/**
 * A step of a "first steps" guide (T39): its number in a ring, filled amber for the next one to do,
 * a green check once done. Decorative: the row says in words whether it is done.
 */
export function GuideMark({ n, done, current = false }: { n: number; done: boolean; current?: boolean }) {
  if (done) {
    return (
      <span className={`${styles.mark} ${styles.done}`} aria-hidden="true">
        <Check size={15} strokeWidth={3} />
      </span>
    );
  }
  return (
    <span className={`${styles.mark} ${current ? styles.current : styles.todo}`} aria-hidden="true">
      {n}
    </span>
  );
}
