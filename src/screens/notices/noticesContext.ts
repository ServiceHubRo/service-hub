import { createContext, useContext } from 'react';
import type { MyNotice } from '../../data/notices';

export interface NoticesValue {
  /** Newest first; empty while loading or when the read failed (a notice is never in the way). */
  notices: MyNotice[];
  /** The first read has answered (with notices, none, or an error). */
  loaded: boolean;
  /** Notices not opened yet (the team's conversation counts on the Mesaje tab while there are any). */
  unread: number;
  /** Seen: no longer new, here at once and on every device. */
  markRead: (noticeIds: string[]) => void;
}

export const NoticesContext = createContext<NoticesValue | null>(null);

/** Null outside the client and shop interfaces. */
export function useOptionalNotices(): NoticesValue | null {
  return useContext(NoticesContext);
}
