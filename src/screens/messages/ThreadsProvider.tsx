import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useSession } from '../../app/sessionContext';
import { fetchThreads, type ThreadSummary } from '../../data/messages';
import { subscribeRows } from '../../data/realtime';
import type { Side } from '../../lib/messages';
import { useLoad } from '../../lib/useLoad';
import { ThreadsContext, type ThreadsValue } from './threadsContext';

function byNewest(a: ThreadSummary, b: ThreadSummary): number {
  return Date.parse(b.last_message_at ?? '') - Date.parse(a.last_message_at ?? '') || 0;
}

/**
 * Loads the caller's conversations once for the whole client or shop interface and keeps them
 * live (CLAUDE.md §6.9): every new message and every read marker touches the thread's row, so
 * Realtime on `threads` (filtered to the client, or to the shop) is enough to know when to read
 * the list again — the last message moves the thread to the top, the unread counts and the badge
 * on the Mesaje tab follow, also when the same account reads on another device.
 */
export function ThreadsProvider({ side, children }: { side: Side; children: ReactNode }) {
  const { user } = useSession();
  const userId = user?.id ?? '';
  const load = useCallback(() => fetchThreads(side), [side]);
  const { state, reload, setData } = useLoad(load);

  // A quiet read started before a newer local change must not put the older list back.
  const generation = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  const refresh = useCallback(() => {
    window.clearTimeout(timer.current);
    // A burst of changes (a message and the read marker it moves) costs one read.
    timer.current = window.setTimeout(function read() {
      const started = generation.current;
      fetchThreads(side).then(
        (data) => {
          if (!mounted.current) return;
          if (started === generation.current) setData(data);
          else timer.current = window.setTimeout(read, 0);
        },
        () => {}, // the list on screen stays; the next change or reconnect reads again
      );
    }, 200);
  }, [side, setData]);

  const patch = useCallback(
    (threadId: string, change: Partial<ThreadSummary>) => {
      generation.current += 1;
      setData((prev) => ({
        ...prev,
        threads: prev.threads.map((t) => (t.thread_id === threadId ? { ...t, ...change } : t)).sort(byNewest),
      }));
    },
    [setData],
  );

  const shopId = state.status === 'ready' ? state.data.shopId : null;
  const filter = side === 'client' ? (userId ? `client_id=eq.${userId}` : null) : shopId ? `shop_id=eq.${shopId}` : null;
  const ready = state.status === 'ready';
  useEffect(() => {
    if (!filter || !ready) return;
    return subscribeRows({
      channel: `threads:${filter}`,
      table: 'threads',
      filter,
      onChange: refresh,
      onResync: refresh,
    });
  }, [filter, ready, refresh]);

  const value = useMemo<ThreadsValue>(() => ({ side, state, reload, refresh, patch }), [side, state, reload, refresh, patch]);
  return <ThreadsContext.Provider value={value}>{children}</ThreadsContext.Provider>;
}
