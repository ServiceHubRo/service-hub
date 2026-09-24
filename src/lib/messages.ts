import { formatDate, formatMoney, formatTime, ymdInBucharest } from '../i18n/format';
import type { MessageKey } from '../i18n/ro';
import { translate, type Lang } from '../i18n/translate';

/**
 * Messages (FR §3.7, §4.4; ARCHITECTURE §2 Messages). Automatic messages are stored as an event
 * code + parameters and turned into text here, in the reader's language and from the reader's
 * side: the client reads "Programarea P-000123 e confirmată", the shop "Ai confirmat programarea
 * P-000123".
 */

export type Side = 'client' | 'shop';

export type JsonParams = Record<string, unknown>;

/** Events with a text of their own; anything else reads as a generic update of the booking. */
const EVENTS = [
  'booking_requested',
  'booking_confirmed',
  'booking_declined',
  'booking_rescheduled',
  'booking_cancelled_client',
  'booking_cancelled_shop',
  'booking_cancelled_admin',
  'no_show',
  'inspection_started',
  'quote_sent',
  'quote_replaced',
  'quote_withdrawn',
  'quote_accepted',
  'quote_partially_accepted',
  'quote_refused',
  'quote_expired',
  'work_started',
  'job_done',
] as const;

const known: ReadonlySet<string> = new Set(EVENTS);

/** `sysmsg.<event>.<side>` for every event in EVENTS: the i18n test checks both languages have them. */
export function systemMessageKeys(): MessageKey[] {
  return EVENTS.flatMap((e) => [`sysmsg.${e}.client`, `sysmsg.${e}.shop`] as MessageKey[]);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** `Mar 14 oct, 10:00` from a booking's date + slot parameters (empty when missing). */
function when(lang: Lang, date: unknown, slot: unknown): string {
  const d = str(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const s = str(slot).slice(0, 5);
  return s ? `${formatDate(lang, d)}, ${s}` : formatDate(lang, d);
}

/** The text of an automatic message for the reader on `side`. */
export function systemMessageText(lang: Lang, side: Side, event: string | null, params: JsonParams | null): string {
  const p = params ?? {};
  const ref = str(p.ref);
  if (!event || !known.has(event)) return translate(lang, 'sysmsg.unknown', { ref });
  const money = (value: unknown) => formatMoney(lang, num(value) ?? 0);
  const values: Record<string, string> = {
    ref,
    when: when(lang, p.date, p.slot),
    total: money(p.total),
    totalSent: money(p.total_sent),
  };
  let text = translate(lang, `sysmsg.${event}.${side}` as MessageKey, values);

  const reason = str(p.reason).trim();
  if (reason) text += ` ${translate(lang, 'sysmsg.reason', { reason })}`;
  const fee = num(p.inspection_fee);
  if (event === 'quote_refused' && fee !== null && fee > 0) text += ` ${translate(lang, 'sysmsg.fee', { fee: money(fee) })}`;
  const cost = num(p.cost);
  if (event === 'job_done' && cost !== null && cost > 0) text += ` ${translate(lang, 'sysmsg.cost', { cost: money(cost) })}`;
  return text;
}

/** What a thread row, a message and the unread count need to know about a message's author. */
export interface MessageLike {
  kind: string;
  sender_id: string | null;
  params: JsonParams | null;
}

/**
 * Whether a message belongs to the reader's side (drawn on the right, never unread). The same rule
 * as `message_is_own_side` in the database: a client's own messages and the automatic messages
 * they caused; for a shop, every member's messages and the automatic messages the shop caused.
 */
export function isOwnSide(m: MessageLike, side: Side, clientId: string | null): boolean {
  if (m.kind === 'system') return str(m.params?.by) === side;
  if (side === 'client') return clientId !== null && m.sender_id === clientId;
  return m.sender_id !== null && m.sender_id !== clientId;
}

/** Time of a message in a list: `14:05` today, `Ieri` yesterday, else `Mar 14 oct`. */
export function formatListTime(lang: Lang, iso: string, now: Date): string {
  const date = new Date(iso);
  const day = ymdInBucharest(date);
  const today = ymdInBucharest(now);
  if (day === today) return formatTime(lang, date);
  const yesterday = ymdInBucharest(new Date(now.getTime() - 86_400_000));
  if (day === yesterday) return translate(lang, 'rel.yesterday.cap');
  return formatDate(lang, day);
}

/** Heading for a day of messages: `Azi`, `Ieri`, else `Mar 14 oct`. */
export function formatDayHeading(lang: Lang, day: string, now: Date): string {
  if (day === ymdInBucharest(now)) return translate(lang, 'rel.today.cap');
  if (day === ymdInBucharest(new Date(now.getTime() - 86_400_000))) return translate(lang, 'rel.yesterday.cap');
  return formatDate(lang, day);
}

/** Merges messages by id and keeps them in time order (a live insert and a re-read may overlap). */
export function mergeMessages<T extends { id: string; created_at: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  // Realtime and PostgREST may spell the same instant differently, so compare instants first.
  return [...byId.values()].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}

/** Initials for an avatar: "Ana Marin" → "AM"; nothing → "?". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}
