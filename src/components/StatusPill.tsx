import type { ReactNode } from 'react';
import { useI18n } from '../i18n/context';
import type { BookingStatus } from '../lib/status';
import { bookingTone, type PillTone, type Viewer } from '../lib/statusTone';
import styles from './StatusPill.module.css';

/**
 * A status as a short label in a pill (page templates, Eduard 14 Nov 2026). The tone carries the
 * meaning (src/lib/statusTone.ts); the label always says it in words.
 */
export function StatusPill({ tone, children, className }: { tone: PillTone; children: ReactNode; className?: string }) {
  return <span data-ui="status-pill" className={`${styles.pill} ${styles[tone]}${className ? ` ${className}` : ''}`}>{children}</span>;
}

/**
 * The colors the screens used before one pill (consistency audit, Eduard 14 Nov 2026), by what they
 * meant: amber asked to act, green went well, red is a problem, grey / muted is closed, blue was
 * information (a step someone else takes).
 */
export type LegacyTone = 'amber' | 'green' | 'red' | 'grey' | 'muted' | 'blue';
const LEGACY: Record<LegacyTone, PillTone> = { amber: 'action', green: 'success', red: 'problem', grey: 'closed', muted: 'closed', blue: 'neutral' };
export const toneOf = (tone: string): PillTone => LEGACY[tone as LegacyTone] ?? 'neutral';

/** A booking's status, colored for the person reading it. */
export function BookingStatusPill({ status, viewer }: { status: BookingStatus; viewer: Viewer }) {
  const { t } = useI18n();
  return <StatusPill tone={bookingTone(status, viewer)}>{t(`status.${status}`)}</StatusPill>;
}
