import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import styles from './ListRow.module.css';

export interface ListRowProps {
  /** A small drawing in a tinted square (a service, a car). */
  icon: ReactNode;
  title: string;
  /** One line of details: date, place, car. Cut with „…” when it does not fit. */
  detail: ReactNode;
  /** The status (StatusPill). */
  status?: ReactNode;
  /** Waits for the reader: its icon is amber and the row is first in the list. */
  attention?: boolean;
  /** The item open beside the list (from 1024 px). */
  selected?: boolean;
  /** A screen to open, or what choosing the row does. */
  to?: string;
  onSelect?: () => void;
}

/**
 * One item of a list (page template A): the same height whatever it holds — an icon, the title, one
 * line of details, the status — and a chevron. A list shows the summary; the detail shows the rest,
 * so a row never carries a quote, a progress bar or buttons.
 */
export function ListRow({ icon, title, detail, status, attention = false, selected = false, to, onSelect }: ListRowProps) {
  const body = (
    <>
      <span className={`${styles.icon} ${attention ? styles.iconAttention : ''}`} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        <span className={styles.detail}>{detail}</span>
        {status && <span className={styles.status}>{status}</span>}
      </span>
      <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
    </>
  );
  const cls = `${styles.row} ${selected ? styles.selected : ''}`;
  return (
    <li className={styles.item}>
      {to ? (
        <Link to={to} className={cls} aria-current={selected ? 'true' : undefined} onClick={onSelect}>
          {body}
        </Link>
      ) : (
        <button type="button" className={cls} aria-current={selected ? 'true' : undefined} onClick={onSelect}>
          {body}
        </button>
      )}
    </li>
  );
}

/** The rows of a list, one under the other, apart by a little space. */
export function ListRows({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className={styles.rows} aria-label={label}>
      {children}
    </ul>
  );
}

/** A list loading: rows of the same shape, never an empty list. */
export function ListRowsSkeleton({ count = 4, label }: { count?: number; label: string }) {
  return (
    <div className={styles.rows} aria-busy="true" role="status">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`${styles.row} ${styles.skeleton}`} aria-hidden="true">
          <span className={`${styles.icon} ${styles.bone}`} />
          <span className={styles.text}>
            <span className={`${styles.bone} ${styles.boneTitle}`} />
            <span className={`${styles.bone} ${styles.boneDetail}`} />
            <span className={`${styles.bone} ${styles.bonePill}`} />
          </span>
        </div>
      ))}
    </div>
  );
}
