import { useEffect, useRef } from 'react';
import { useSession } from '../../app/sessionContext';
import { subscribeRows } from '../../data/realtime';

/**
 * The author's support screens kept live (A3c1): a change the author can see on one of its own
 * requests — the team's answer, a new state, a file — calls `onChange` (several in a row once), and so
 * does every reconnect. The signal names only the request; the screen reads it again through the
 * functions that decide what the author may see. The team's internal work never signals here.
 */
export function useAuthorSignals(onChange: () => void) {
  const uid = useSession().profile?.id;
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });

  useEffect(() => {
    if (!uid) return;
    let timer: number | undefined;
    const fire = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => latest.current(), 300);
    };
    const off = subscribeRows({ channel: `support-author:${uid}`, table: 'support_signals', filter: `author_id=eq.${uid}`, onChange: fire, onResync: fire });
    return () => {
      window.clearTimeout(timer);
      off();
    };
  }, [uid]);
}
