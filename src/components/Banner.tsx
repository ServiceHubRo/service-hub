import { CircleAlert, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './Banner.module.css';

export type BannerTone = 'info' | 'warning' | 'error';

const ICONS: Record<BannerTone, LucideIcon> = { info: Info, warning: TriangleAlert, error: CircleAlert };

export interface BannerProps {
  tone?: BannerTone;
  children: ReactNode;
  action?: ReactNode;
}

export function Banner({ tone = 'info', children, action }: BannerProps) {
  const Icon = ICONS[tone];
  return (
    <div className={`${styles.banner} ${styles[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={18} className={styles.icon} aria-hidden="true" />
      <div className={styles.text}>{children}</div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
