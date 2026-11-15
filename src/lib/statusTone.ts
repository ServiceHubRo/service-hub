import type { BookingStatus } from './status';

/**
 * What a status pill's color says (Eduard, 14 Nov 2026, page templates): amber asks the person who
 * reads it to act, green says it went well, red says something is wrong, grey says it is closed.
 * `neutral` is a step someone else takes (the shop inspecting the car): no fill, no alarm. Every
 * ended status is grey, whatever happened. The text always says the status too (never color alone).
 */
export type PillTone = 'action' | 'success' | 'problem' | 'closed' | 'neutral';

/** Who reads the pill: the client, the shop, or the platform's team (nothing waits for them). */
export type Viewer = 'client' | 'shop' | 'admin';

const ENDED: ReadonlySet<BookingStatus> = new Set(['done', 'declined', 'cancelled', 'quote_refused', 'expired', 'no_show']);

/** A booking's pill for the person looking at it: what waits for them is amber. */
export function bookingTone(status: BookingStatus, viewer: Viewer): PillTone {
  if (ENDED.has(status)) return 'closed';
  if (viewer === 'admin') return status === 'confirmed' || status === 'approved' ? 'success' : 'neutral';
  if (viewer === 'client') {
    if (status === 'quote_sent') return 'action';
    if (status === 'confirmed' || status === 'approved') return 'success';
    return 'neutral';
  }
  if (status === 'pending' || status === 'in_inspection') return 'action';
  if (status === 'confirmed' || status === 'approved') return 'success';
  return 'neutral';
}

/** True when the booking waits for this viewer: such rows come first and are marked. */
export function needsAction(status: BookingStatus, viewer: Viewer): boolean {
  return bookingTone(status, viewer) === 'action';
}

/**
 * The colors the screens used before one pill (consistency audit, Eduard 14 Nov 2026), by what they
 * meant: amber asked to act, green went well, red is a problem, grey / muted is closed, blue was
 * information (a step someone else takes).
 */
export type LegacyTone = 'amber' | 'green' | 'red' | 'grey' | 'muted' | 'blue';
const LEGACY: Record<LegacyTone, PillTone> = { amber: 'action', green: 'success', red: 'problem', grey: 'closed', muted: 'closed', blue: 'neutral' };
export const toneOf = (tone: string): PillTone => LEGACY[tone as LegacyTone] ?? 'neutral';
