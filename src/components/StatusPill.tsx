import type { ReactNode } from 'react';
import { useI18n } from '../i18n/context';
import type { BookingStatus } from '../lib/status';
import { bookingTone, type PillTone, type Viewer } from '../lib/statusTone';
import styles from './StatusPill.module.css';

/**
 * A status as a short label in a pill (page templates, Eduard 14 Nov 2026). The tone carries the
 * meaning (src/lib/statusTone.ts); the label always says it in words.
 */
export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`${styles.pill} ${styles[tone]}`}>{children}</span>;
}

/** A booking's status, colored for the person reading it. */
export function BookingStatusPill({ status, viewer }: { status: BookingStatus; viewer: Viewer }) {
  const { t } = useI18n();
  return <StatusPill tone={bookingTone(status, viewer)}>{t(`status.${status}`)}</StatusPill>;
}
