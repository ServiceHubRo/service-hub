import { useCallback, useRef, useState } from 'react';
import {
  fetchInbox,
  fetchSupportDashboard,
  INBOX_PAGE,
  type InboxCursor,
  type InboxQuery,
  type StaffRequestItem,
  type SupportDashboard,
} from '../../data/supportRequests';
import { useLiveData } from '../admin/useLiveData';

/** What the team's live screens listen to: "a request changed", never its content (A3c1). */
export const TEAM_SIGNALS = [{ table: 'support_signals', filter: 'audience=eq.team' }] as const;

export interface InboxData {
  /** The filters this list answers (a newer one is on its way while they differ). */
  key: string;
  dashboard: SupportDashboard;
  me: string;
  items: StaffRequestItem[];
  next: InboxCursor | null;
}

/** The first `count` rows of a filter (at least one page), read 100 at a time. */
async function firstRows(query: InboxQuery, count: number) {
  const page = await fetchInbox(query, null, Math.min(Math.max(count, INBOX_PAGE), 100));
  let { items, next } = page;
  while (next && items.length < count) {
    const more = await fetchInbox(query, next, Math.min(count - items.length, 100));
    items = [...items, ...more.items];
    next = more.next;
  }
  return { me: page.me, items, next };
}

/**
 * The team's Solicitări (A3c1): the counters and the list for the filters in the address, one page
 * at a time, kept live — any change to any request reads the counters and the rows already shown
 * again, quietly (several changes in a row cost one read), and so does every reconnect.
 */
export function useInbox(query: InboxQuery) {
  const key = JSON.stringify(query);
  // How many rows are shown for which filters: a live update reads that many again, never fewer;
  // other filters start again from one page.
  const shown = useRef({ key, n: INBOX_PAGE });

  const load = useCallback(async (): Promise<InboxData> => {
    if (shown.current.key !== key) shown.current = { key, n: INBOX_PAGE };
    const q = JSON.parse(key) as InboxQuery;
    const [dashboard, rows] = await Promise.all([fetchSupportDashboard(), firstRows(q, shown.current.n)]);
    return { key, dashboard, ...rows };
  }, [key]);
  const live = useLiveData(load, TEAM_SIGNALS, 'support-inbox');

  // „Arată mai multe”: busy or failed for one set of filters only.
  const [moreState, setMore] = useState<{ key: string; busy: boolean; failed: boolean }>({ key, busy: false, failed: false });
  const more = moreState.key === key ? moreState : { key, busy: false, failed: false };

  // One more page: the list is read again with 30 more rows, through the same read as a live update,
  // so an update already on its way (with fewer rows) can never replace the longer list.
  const { refetch } = live;
  const loadMore = useCallback(
    async (data: InboxData) => {
      if (!data.next) return;
      setMore({ key: data.key, busy: true, failed: false });
      shown.current = { key: data.key, n: data.items.length + INBOX_PAGE };
      try {
        await refetch();
        setMore({ key: data.key, busy: false, failed: false });
      } catch {
        shown.current = { key: data.key, n: data.items.length };
        setMore({ key: data.key, busy: false, failed: true });
      }
    },
    [refetch],
  );

  return { ...live, key, more, loadMore };
}
