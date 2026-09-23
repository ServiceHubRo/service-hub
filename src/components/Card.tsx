import type { HTMLAttributes } from 'react';
import styles from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Amber border for items that need attention (e.g. a quote waiting for a decision). */
  highlight?: boolean;
  /** Inner panel on surface2 (quote lines, inline forms). */
  inset?: boolean;
}

export function Card({ highlight, inset, className, ...rest }: CardProps) {
  const cls = [inset ? styles.inset : styles.card, highlight ? styles.highlight : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return <div className={cls} {...rest} />;
}
