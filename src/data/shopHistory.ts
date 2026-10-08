import { call } from './rpc';
import type { CarSnapshot } from './bookings';
import type { Quote } from '../lib/clientBookings';
import { endedDay, type HistoryStatus } from '../lib/history';
import type { ExtraService } from '../lib/bookingServices';

/**
 * The shop's repair history (FR §4.3, P16b; T10), in one read: `list_shop_history()` answers only
 * for the caller's own shop with every finished booking — done, quote refused, expired, canceled,
 * no-show — newest first, with the quote that belongs to how it ended.
 */

export type HistoryQuote = Omit<Quote, 'expires_at'>;

export interface ShopHistoryItem {
  id: string;
  ref: string;
  status: HistoryStatus;
  date: string; // YYYY-MM-DD, Europe/Bucharest
  slot: string; // HH:MM, Europe/Bucharest
  note: string | null;
  service_id: string;
  service_ro: string | null;
  service_en: string | null;
  service_icon: string | null;
  /** The other services of the same booking (T21), in the order they were ticked. */
  extra_services?: ExtraService[];
  client_name: string | null;
  client_phone: string | null;
  /** False once the client deleted the account (no conversation to open). */
  has_client: boolean;
  car_snapshot: CarSnapshot;
  odometer: number | null;
  work: string | null;
  cost: number | null;
  done_at: string | null;
  cancelled_by: 'client' | 'shop' | 'admin' | null;
  cancel_reason: string | null;
  /** `not_updated` when the system closed a confirmed booking left open for 7 days. */
  closed_reason: 'unanswered' | 'not_updated' | null;
  /** When it ended: finished, canceled, or the last status change. */
  ended_at: string;
  /** The accepted version of a finished job, the refused or the expired one; else null. */
  quote: HistoryQuote | null;
  /** T31a: brought from another program — no booking, code, quote or conversation behind it. */
  imported?: boolean;
}

/** A job the shop imported from another program (T31a), as `list_shop_history` answers it. */
interface ImportedJob {
  id: string;
  day: string;
  client_name: string | null;
  client_phone: string | null;
  car_snapshot: CarSnapshot;
  odometer: number | null;
  work: string | null;
  cost: number | null;
}

export interface ShopHistoryData {
  shop: { id: string; name: string };
  /** The bookings that ended, newest first. */
  bookings: ShopHistoryItem[];
  /** T31a: the newest imported jobs (a page); older ones through `fetchImportedPage`. */
  imported: ShopHistoryItem[];
  /** How many imported jobs the shop has in all. */
  importedTotal: number;
}

/** One page of imported jobs and whether there is another after it. */
export interface ImportedPage {
  items: ShopHistoryItem[];
  more: boolean;
}

/** An imported job in the shape of a finished one, marked `imported`. */
function fromImported(j: ImportedJob): ShopHistoryItem {
  return {
    id: j.id,
    ref: '',
    status: 'done',
    date: j.day,
    slot: '',
    note: null,
    service_id: '',
    service_ro: null,
    service_en: null,
    service_icon: null,
    client_name: j.client_name,
    client_phone: j.client_phone,
    has_client: false,
    car_snapshot: j.car_snapshot,
    odometer: j.odometer,
    work: j.work,
    cost: toNumberOrNull(j.cost),
    done_at: null,
    cancelled_by: null,
    cancel_reason: null,
    closed_reason: null,
    // Midday UTC is the same day in Bucharest.
    ended_at: `${j.day}T10:00:00Z`,
    quote: null,
    imported: true,
  };
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : toNumber(value);
}

type RawHistory = Omit<ShopHistoryData, 'imported' | 'importedTotal'> & { imported?: ImportedJob[]; imported_total?: number };

/** Amounts arrive as JSON numbers from numeric columns; normalized once here. */
function normalize(data: RawHistory): ShopHistoryData {
  return {
    shop: data.shop,
    bookings: data.bookings.map((b) => ({
      ...b,
      cost: toNumberOrNull(b.cost),
      quote: b.quote && {
        ...b.quote,
        inspection_fee: toNumber(b.quote.inspection_fee),
        total_sent: toNumber(b.quote.total_sent),
        total_approved: toNumberOrNull(b.quote.total_approved),
        items: b.quote.items.map((i) => ({ ...i, price: toNumber(i.price) })),
      },
    })),
    imported: (data.imported ?? []).map(fromImported),
    importedTotal: data.imported_total ?? 0,
  };
}

export async function fetchShopHistory(): Promise<ShopHistoryData> {
  const data = await call('list_shop_history', {} as never);
  return normalize(data as unknown as RawHistory);
}

const PAGE = 100;

/**
 * Imported jobs newest first, after `after` (the last one shown), holding every word of `query`
 * (searched in the database: plate, client, phone, car, work, odometer).
 */
export async function fetchImportedPage(query: string, after?: ShopHistoryItem): Promise<ImportedPage> {
  const data = (await call('list_imported_jobs', {
    p_query: query.trim() || undefined,
    p_before_day: after?.date,
    p_before_id: after?.id,
    p_limit: PAGE,
  })) as unknown as { jobs: ImportedJob[] };
  const items = data.jobs.map(fromImported);
  return { items: items.slice(0, PAGE), more: items.length > PAGE };
}

/** Both lists newest first, merged by the day they ended (a booking first on the same day). */
export function mergeHistory(bookings: readonly ShopHistoryItem[], imported: readonly ShopHistoryItem[]): ShopHistoryItem[] {
  const merged: ShopHistoryItem[] = [];
  let i = 0;
  let j = 0;
  while (i < bookings.length || j < imported.length) {
    const b = bookings[i];
    const m = imported[j];
    if (b && (!m || endedDay(b) >= m.date)) merged.push(bookings[i++]!);
    else merged.push(imported[j++]!);
  }
  return merged;
}
