import { createContext, useContext } from 'react';
import type { ThreadsData, ThreadSummary } from '../../data/messages';
import type { Side } from '../../lib/messages';
import type { LoadState } from '../../lib/useLoad';

export interface ThreadsValue {
  side: Side;
  state: LoadState<ThreadsData>;
  /** After a failed load: shows loading again and reads the list. */
  reload: () => void;
  /** Reads the list again quietly (the screen keeps showing the current one). */
  refresh: () => void;
  /** Changes one thread in place at once (a message just sent, a thread just read). */
  patch: (threadId: string, change: Partial<ThreadSummary>) => void;
}

export const ThreadsContext = createContext<ThreadsValue | null>(null);

/** The caller's conversations, shared by Mesaje, the conversation and the badge on its tab. */
export function useThreads(): ThreadsValue {
  const value = useContext(ThreadsContext);
  if (!value) throw new Error('useThreads outside ThreadsProvider');
  return value;
}

/** Null outside the client and shop interfaces. */
export function useOptionalThreads(): ThreadsValue | null {
  return useContext(ThreadsContext);
}

/** Conversations with at least one unread message (the badge on the Mesaje tab). */
export function unreadThreads(threads: readonly ThreadSummary[]): number {
  return threads.filter((t) => t.unread > 0).length;
}
