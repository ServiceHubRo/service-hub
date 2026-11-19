import {
  Activity,
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  CircleCheck,
  ClipboardCheck,
  CreditCard,
  FileText,
  Receipt,
  ShieldCheck,
  Star,
  Store,
  UserPlus,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { LoadError } from '../../components/LoadError';
import { fetchAccountActivity, type AccountActivityItem, type AccountActivityKind } from '../../data/admin';
import { useI18n, type I18nValue } from '../../i18n/context';
import { formatMoney } from '../../i18n/format';
import type { MessageKey } from '../../i18n/ro';
import { useLoad } from '../../lib/useLoad';
import { dateTime, actionLabel } from './format';
import { adminBookingPath, ADMIN_MODERATION_PATH } from './paths';

const ICON: Record<AccountActivityKind, LucideIcon> = {
  account_created: UserPlus,
  shop_created: Store,
  booking_created: CalendarPlus,
  booking_confirmed: CalendarCheck,
  booking_in_inspection: ClipboardCheck,
  booking_in_progress: Wrench,
  booking_done: CircleCheck,
  booking_cancelled: CalendarX,
  booking_declined: CalendarX,
  booking_expired: CalendarX,
  booking_no_show: CalendarX,
  booking_quote_refused: CalendarX,
  quote_sent: FileText,
  quote_accepted: FileText,
  quote_partially_accepted: FileText,
  quote_refused: FileText,
  review_written: Star,
  review_received: Star,
  review_reply: Star,
  review_reported: Star,
  invoice_issued: Receipt,
  payment_failed: CreditCard,
  staff_joined: Users,
  admin_action: ShieldCheck,
};

/** What waits for someone or went wrong: an amber icon. */
const NEEDS_EYES: ReadonlySet<AccountActivityKind> = new Set(['payment_failed', 'review_reported', 'booking_no_show']);

/** A booking's steps read like its statuses; the rest has its own words. */
const STATUS_OF: Partial<Record<AccountActivityKind, MessageKey>> = {
  booking_confirmed: 'status.confirmed',
  booking_in_inspection: 'status.in_inspection',
  booking_in_progress: 'status.in_progress',
  booking_done: 'status.done',
  booking_cancelled: 'status.cancelled',
  booking_declined: 'status.declined',
  booking_expired: 'status.expired',
  booking_no_show: 'status.no_show',
  booking_quote_refused: 'status.quote_refused',
  quote_sent: 'status.quote_sent',
  quote_accepted: 'status.approved',
  quote_refused: 'status.quote_refused',
};

function kindLabel(t: I18nValue['t'], kind: AccountActivityKind): string {
  const status = STATUS_OF[kind];
  return status ? t(status) : t(`admin.acct.kind.${kind}` as MessageKey);
}

/** The line under the title: who or what it is about (the shop, the client, the booking, the amount). */
function lineOf(t: I18nValue['t'], lang: I18nValue['lang'], a: AccountActivityItem): string {
  const d = a.detail;
  const service = lang === 'ro' ? a.service_ro : a.service_en;
  const who = (v: string | number | null | undefined) =>
    v === 'client' || v === 'shop' || v === 'admin' ? t('admin.acct.by', { who: t(`admin.acct.who.${v}` as MessageKey) }) : null;
  switch (a.kind) {
    case 'admin_action':
      return [actionLabel(t, String(d.action ?? '')), a.name].filter(Boolean).join(' · ');
    case 'shop_created':
      return [a.name, d.city].filter(Boolean).join(', ');
    case 'review_written':
    case 'review_received':
      return [a.name, typeof d.rating === 'number' ? t('admin.acct.rating', { n: d.rating }) : null].filter(Boolean).join(' · ');
    case 'review_reported':
      return [a.name, typeof d.reason === 'string' ? t(`reviews.reason.${d.reason}` as MessageKey) : null].filter(Boolean).join(' · ');
    case 'invoice_issued':
      return [a.ref, typeof d.amount === 'number' ? formatMoney(lang, d.amount) : null].filter(Boolean).join(' · ');
    case 'booking_cancelled':
    case 'quote_accepted':
    case 'quote_partially_accepted':
    case 'quote_refused':
      return [a.ref, a.name, service, who(d.by)].filter(Boolean).join(' · ');
    default:
      return [a.ref, a.name, service].filter(Boolean).join(' · ');
  }
}

function linkOf(a: AccountActivityItem): string | undefined {
  if (a.kind === 'review_reported') return ADMIN_MODERATION_PATH;
  if (a.kind.startsWith('booking_') || a.kind.startsWith('quote_')) return a.booking_id ? adminBookingPath(a.booking_id) : undefined;
  return undefined;
}

/**
 * The history of ONE account, under that account in admin (Eduard, 16 Nov 2026: a list of the last 50
 * things of the whole platform does not work with thousands of users): newest first, a page of 30 at
 * a time with „Mai vechi”. It comes from the database as it is (the moments a booking reached each
 * step, the quotes, the reviews, the payments, the team, what an admin did): nothing private, no message.
 */
export function AccountActivity({ kind, id }: { kind: 'client' | 'shop'; id: string }) {
  const { t, lang } = useI18n();
  const load = useCallback(() => fetchAccountActivity(kind, id), [kind, id]);
  const { state, reload } = useLoad(load);
  // The pages after the first one: kept here, the first one is read (and read again) by useLoad.
  const [extra, setExtra] = useState<{ items: AccountActivityItem[]; more: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (state.status === 'loading') return <ListRowsSkeleton label={t('common.loading')} />;
  if (state.status === 'error')
    return (
      <LoadError
        message={t('admin.loadError')}
        onRetry={() => {
          setExtra(null);
          reload();
        }}
      />
    );

  const items = [...state.data.items, ...(extra?.items ?? [])];
  const more = extra ? extra.more : state.data.more;
  if (items.length === 0) return <EmptyState icon={Activity} title={t('admin.acct.empty')} />;

  async function older() {
    const last = items[items.length - 1]!;
    setBusy(true);
    setFailed(false);
    try {
      const page = await fetchAccountActivity(kind, id, { at: last.at, key: last.key });
      setExtra({ items: [...(extra?.items ?? []), ...page.items], more: page.more });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ListRows label={t('admin.acct.list')}>
        {items.map((a) => {
          const Icon = ICON[a.kind];
          const line = lineOf(t, lang, a);
          return (
            <ListRow
              key={a.key}
              icon={<Icon size={20} />}
              title={kindLabel(t, a.kind)}
              detail={[dateTime(lang, a.at), line].filter(Boolean).join(' · ')}
              attention={NEEDS_EYES.has(a.kind)}
              to={linkOf(a)}
            />
          );
        })}
      </ListRows>
      {more && (
        <div>
          <Button onClick={() => void older()} disabled={busy} aria-busy={busy}>
            {t('bookings.older')}
          </Button>
        </div>
      )}
      {failed && (
        <p role="alert">
          {t('admin.loadError')}{' '}
          <Button variant="ghost" onClick={() => void older()}>
            {t('action.retry')}
          </Button>
        </p>
      )}
    </>
  );
}
