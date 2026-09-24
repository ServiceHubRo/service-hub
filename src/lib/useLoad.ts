import { useCallback, useEffect, useState } from 'react';

export type LoadState<T> = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: T };

/**
 * Loads data once per `load` (keep it stable with useCallback). `reload()` shows the loading state
 * again (after an error); `setData()` replaces the data in place after a save, so the screen never
 * flashes back to a skeleton or jumps to the top.
 */
export function useLoad<T>(load: () => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'error', error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((a) => a + 1);
  }, []);

  const setData = useCallback((next: T | ((prev: T) => T)) => {
    setState((prev) => {
      if (typeof next !== 'function') return { status: 'ready', data: next };
      return prev.status === 'ready' ? { status: 'ready', data: (next as (p: T) => T)(prev.data) } : prev;
    });
  }, []);

  return { state, reload, setData };
}
