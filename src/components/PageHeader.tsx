import type { ReactNode } from 'react';
import { BackLink } from './BackLink';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  title: string;
  /** One line under the title (a count, the account type). */
  subtitle?: ReactNode;
  /** The way back (a sub-page): above the title. */
  back?: { to: string; label: string };
  /** The page's own actions, on the right of the title on a wide screen. */
  actions?: ReactNode;
}

/**
 * The top of every page (T51): the way back, the title and its line, the page's actions on the right.
 * Every screen starts at the same height, with the same left edge and the same type sizes.
 */
export function PageHeader({ title, subtitle, back, actions }: PageHeaderProps) {
  return (
    <>
      {back && <BackLink to={back.to} label={back.label} />}
      <header className={styles.header}>
        <div className={styles.text}>
          <h1>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
    </>
  );
}
