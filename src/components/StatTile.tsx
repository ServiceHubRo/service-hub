import { ChevronRight } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/context';
import { ListRows } from './ListRow';
import styles from './StatTile.module.css';

/** Page template D, a dashboard: its figures in equal boxes on one row (2 on a phone). */
export function StatGrid({ label, children, className, tour }: { label: string; children: ReactNode; className?: string; tour?: string }) {
  return (
    <ul data-ui="stat-grid" className={`${styles.grid}${className ? ` ${className}` : ''}`} aria-label={label} data-tour={tour}>
      {children}
    </ul>
  );
}

/**
 * One figure and what it counts, the same box on every dashboard (shop, company, admin, support;
 * docs/MODEL_DE_FOLOSIRE.md). `attention`: it waits for the reader (an amber number); `problem`: a
 * red one (over budget, documents expired); a zero is quiet. `hint`: one line under the label. With
 * `to` (a page) or `onSelect` (a section of the same page) the whole box opens what it counts.
 */
export function StatTile({
  value,
  label,
  hint,
  to,
  onSelect,
  attention = false,
  problem = false,
  wide = false,
  valueRef,
}: {
  value: ReactNode;
  label: string;
  hint?: string;
  to?: string;
  onSelect?: () => void;
  attention?: boolean;
  problem?: boolean;
  /** Takes two columns (a sum of money). */
  wide?: boolean;
  valueRef?: Ref<HTMLSpanElement>;
}) {
  const zero = value === 0 || value === '0';
  const tone = zero ? styles.zero : problem ? styles.problem : attention ? styles.attention : '';
  const body = (
    <>
      <span ref={valueRef} className={`mono ${styles.value} ${tone}`}>
        {value}
      </span>
      <span className={styles.label}>{label}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </>
  );
  return (
    <li data-ui="stat-tile" className={`${styles.item} ${wide ? styles.wide : ''}`}>
      {to ? (
        <Link to={to} className={`${styles.tile} ${styles.link}`}>
          {body}
        </Link>
      ) : onSelect ? (
        <button type="button" className={`${styles.tile} ${styles.link}`} onClick={onSelect}>
          {body}
        </button>
      ) : (
        <div className={styles.tile}>{body}</div>
      )}
    </li>
  );
}

export function StatGridSkeleton({ count = 4, label }: { count?: number; label: string }) {
  return (
    <div data-ui="skeleton" className={styles.grid} aria-busy="true" role="status">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.tile} aria-hidden="true">
          <span className={`${styles.bone} ${styles.boneValue}`} />
          <span className={`${styles.bone} ${styles.boneLabel}`} />
        </div>
      ))}
    </div>
  );
}

/** The sections of a dashboard under its figures: one column, two side by side from 1024 px. */
export function PanelSections({ children }: { children: ReactNode }) {
  return <div className={styles.sections}>{children}</div>;
}

/** Lines a dashboard section shows at most (Eduard, 14 Nov 2026); the rest behind „Vezi toate”. */
export const PANEL_SECTION_MAX = 5;

/**
 * A section of a dashboard: its title, at most five items and „Vezi toate” to the whole list when
 * there are any.
 */
export function PanelSection({
  title,
  items,
  seeAllTo,
  empty,
}: {
  title: string;
  items: ReactNode[];
  seeAllTo?: string;
  /** What the section says with nothing in it. */
  empty: string;
}) {
  // `items` are ListRow elements.
  const { t } = useI18n();
  const shown = items.slice(0, PANEL_SECTION_MAX);
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {seeAllTo && items.length > 0 && (
          <Link to={seeAllTo} className={styles.seeAll}>
            {t('panel.seeAll')}
            <ChevronRight size={16} aria-hidden="true" />
          </Link>
        )}
      </div>
      {shown.length === 0 ? <p className={styles.empty}>{empty}</p> : <ListRows label={title}>{shown}</ListRows>}
    </section>
  );
}
