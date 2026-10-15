import type { CSSProperties } from 'react';
import { motionOn } from '../../lib/motion';
import styles from './history.module.css';

/**
 * A car's jobs as a timeline (Eduard, 15 Oct): a line down the left with a point at each job.
 * Opening the screen, the line grows down and the points appear in turn (src/lib/motion.ts,
 * historyTimeline).
 */
export function timelineClass(): string {
  return `${styles.list} ${styles.timeline} ${motionOn('historyTimeline') ? styles.timelineGrow : ''}`;
}

/** The place of a job on the timeline; past the first few they all come together. */
export function timelineItem(i: number): CSSProperties {
  return { '--i': Math.min(i, 8) } as CSSProperties;
}
