import { useEffect, useRef, useState, type ReactNode } from 'react';
import { countPendingReports } from '../../data/admin';
import { subscribeRows } from '../../data/realtime';
import { AdminCountsContext } from './adminContext';

/**
 * What the whole admin interface needs live: the number of reported reviews waiting for a decision,
 * for the badge on Moderare. Counted again on every change of a review and on every reconnect.
 */
export function AdminProvider({ children }: { children: ReactNode }) {
  const [pendingReports, setPending] = useState<number | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    let timer: number | undefined;
    let alive = true;
    const count = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const mine = ++latest.current;
        countPendingReports().then(
          (n) => {
            if (alive && mine === latest.current) setPending(n);
          },
          () => {},
        );
      }, 200);
    };
    count();
    const off = subscribeRows({ channel: 'admin-reports', table: 'reviews', onChange: count, onResync: count });
    return () => {
      alive = false;
      window.clearTimeout(timer);
      off();
    };
  }, []);

  return <AdminCountsContext.Provider value={{ pendingReports }}>{children}</AdminCountsContext.Provider>;
}
