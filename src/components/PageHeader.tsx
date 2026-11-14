import type { ReactNode } from 'react';
import { BackLink } from './BackLink';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  title: string;
  /** One line under the title (a count, the account type). */
  subtitle?: ReactNode;
  /** The way back (a sub-page): above the title. */
  back?: { to: string; label: string };
  /** The page's own actions, on the right of the title on a wide screen: one main action at most. */
  actions?: ReactNode;
  /** The screen's views (Tabs), under the title. */
  tabs?: ReactNode;
}

/**
 * The top of every page (T51): the way back, the title and its line, the page's actions on the right.
 * Every screen starts at the same height, with the same left edge and the same type sizes. The
 * screen's tabs, when it has views, stand under the title (page templates, 14 Nov 2026).
 */
export function PageHeader({ title, subtitle, back, actions, tabs }: PageHeaderProps) {
  return (
    <>
      {back && <BackLink to={back.to} label={back.label} />}
      <header className={styles.header} data-span="all">
        <div className={styles.text}>
          <h1>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      {tabs && (
        <div className={styles.tabs} data-span="all">
          {tabs}
        </div>
      )}
    </>
  );
}
