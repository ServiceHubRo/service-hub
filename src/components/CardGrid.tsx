import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import styles from './CardGrid.module.css';

/**
 * Page template B, a grid of equal cards to browse (shops, cars; Eduard 14 Nov 2026): 1 column on a
 * phone, 2 on a tablet, 3–4 on a desktop, every card with the same parts and the same height (the
 * tallest card sets every row).
 */
export function CardGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className={styles.grid} aria-label={label}>
      {children}
    </ul>
  );
}

/**
 * One card of a grid: a picture or initials, the title, one line of details, a line of facts
 * (rating, a status) and, at its foot, one short line or a quiet action. The whole card opens the item.
 */
export function GridCard({
  media,
  title,
  detail,
  meta,
  foot,
  to,
  aside,
}: {
  media: ReactNode;
  title: string;
  detail: ReactNode;
  meta?: ReactNode;
  /** The card's last line (the first free day, the next document due). */
  foot?: ReactNode;
  to: string;
  /** A small control in the top right corner that is not the card's link (the heart). */
  aside?: ReactNode;
}) {
  // The title and its line are the link; its hit area covers the card (::after), the corner control stays apart.
  return (
    <li className={styles.card}>
      <span className={styles.top}>
        <span className={styles.media} aria-hidden="true">
          {media}
        </span>
        <Link to={to} className={styles.head}>
          <span className={styles.title}>{title}</span>
          <span className={styles.detail}>{detail}</span>
        </Link>
      </span>
      <span className={styles.meta}>{meta}</span>
      <span className={styles.foot}>
        <span className={styles.footText}>{foot}</span>
        <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
      </span>
      {aside && <span className={styles.aside}>{aside}</span>}
    </li>
  );
}

/** A grid loading: cards of the same shape. */
export function CardGridSkeleton({ count = 6, label }: { count?: number; label: string }) {
  return (
    <div className={styles.grid} aria-busy="true" role="status">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`${styles.card} ${styles.skeleton}`} aria-hidden="true">
          <span className={styles.top}>
            <span className={`${styles.media} ${styles.bone}`} />
            <span className={styles.head}>
              <span className={`${styles.bone} ${styles.boneTitle}`} />
              <span className={`${styles.bone} ${styles.boneLine}`} />
            </span>
          </span>
          <span className={`${styles.bone} ${styles.boneLine}`} />
          <span className={`${styles.bone} ${styles.boneShort}`} />
        </div>
      ))}
    </div>
  );
}
