import { formatDayMonth, formatTime } from '../../i18n/format';
import type { MessageKey } from '../../i18n/ro';
import type { Lang } from '../../i18n/translate';
import { AUDIT_ACTIONS } from '../../lib/admin';

// Small text helpers of the admin screens (T16a).

/** `14 oct, 10:32` (Bucharest); the year when it is not this one. */
export function dateTime(lang: Lang, iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${formatDayMonth(lang, d)}, ${formatTime(lang, d)}`;
}

/** `14 oct` of an instant or a `YYYY-MM-DD` day. */
export function day(lang: Lang, value: string | null | undefined): string {
  if (!value) return '—';
  return formatDayMonth(lang, /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value));
}

export function carText(car: { make?: string | null; model?: string | null; year?: number | null } | null | undefined): string {
  return [car?.make, car?.model, car?.year].filter(Boolean).join(' ');
}

export function actionLabel(t: (key: MessageKey) => string, action: string): string {
  return (AUDIT_ACTIONS as readonly string[]).includes(action) ? t(`admin.action.${action}` as MessageKey) : action;
}

/** Stripe statuses of a subscription Stripe still runs (charges on its own dates). */
export function stripeRuns(stripeStatus: string | null | undefined): boolean {
  return stripeStatus === 'trialing' || stripeStatus === 'active' || stripeStatus === 'past_due' || stripeStatus === 'incomplete';
}

