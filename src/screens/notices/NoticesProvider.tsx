import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSession } from '../../app/sessionContext';
import { fetchMyNotices, markNoticeRead, type MyNotice } from '../../data/notices';
import { subscribeRows } from '../../data/realtime';
import { NoticesContext, type NoticesValue } from './noticesContext';

/**
 * Notices from the Service-Hub team (T16b) for Mesaje and the count on its tab (T20a). Live: a
 * notice sent while the app is open appears at once (Realtime on `notices`, RLS decides who
 * receives it); a withdrawn one disappears.
 */
export function NoticesProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const [notices, setNotices] = useState<MyNotice[]>([]);
  const latest = useRef(0);

  const load = useCallback(() => {
    if (!userId) return;
    const mine = ++latest.current;
    fetchMyNotices(userId).then(
      (list) => {
        if (mine === latest.current) setNotices(list);
      },
      () => {},
    );
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    load();
    return subscribeRows({ channel: `notices:${userId}`, table: 'notices', onChange: load, onResync: load });
  }, [userId, load]);

  const markRead = useCallback((noticeId: string) => {
    setNotices((list) => list.map((n) => (n.id === noticeId ? { ...n, read: true } : n)));
    // Best effort: if it fails, the notice is new again on the next visit.
    markNoticeRead(noticeId).catch(() => {});
  }, []);

  const value = useMemo<NoticesValue>(
    () => ({ notices, unread: notices.filter((n) => !n.read).length, markRead }),
    [notices, markRead],
  );
  return <NoticesContext.Provider value={value}>{children}</NoticesContext.Provider>;
}
