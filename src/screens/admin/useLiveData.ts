import { useCallback, useEffect, useRef } from 'react';
import { subscribeRows } from '../../data/realtime';
import { useLoad } from '../../lib/useLoad';

export interface LiveTable {
  table: string;
  /** PostgREST-style filter; none = every row the admin may read (all of them). */
  filter?: string;
}

/**
 * Loads an admin screen's data and keeps it live (CLAUDE.md §6.9): any change in the given tables
 * reads it again quietly (several changes in a row cost one read; an older answer never replaces a
 * newer one), and so does every reconnect. `load` must be stable (useCallback).
 */
export function useLiveData<T>(load: () => Promise<T>, tables: readonly LiveTable[], channel: string) {
  const { state, reload, setData } = useLoad(load);
  const latest = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const key = tables.map((t) => `${t.table}:${t.filter ?? ''}`).join('|');

  const refresh = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const mine = ++latest.current;
      load().then(
        (data) => {
          if (mine === latest.current) setData(data);
        },
        () => {}, // what is on screen stays; the next change or reconnect reads again
      );
    }, 300);
  }, [load, setData]);

  const ready = state.status === 'ready';
  useEffect(() => {
    if (!ready) return;
    const specs = key.split('|').map((s) => {
      const [table, ...rest] = s.split(':');
      const filter = rest.join(':');
      return { table: table!, filter: filter || undefined };
    });
    const offs = specs.map((spec) =>
      subscribeRows({ channel: `${channel}:${spec.table}`, table: spec.table, filter: spec.filter, onChange: refresh, onResync: refresh }),
    );
    return () => {
      window.clearTimeout(timer.current);
      for (const off of offs) off();
    };
  }, [ready, key, channel, refresh]);

  /** After an action: read again at once, quietly. */
  const refetch = useCallback(() => {
    const mine = ++latest.current;
    return load().then((data) => {
      if (mine === latest.current) setData(data);
    });
  }, [load, setData]);

  return { state, reload, setData, refetch };
}
