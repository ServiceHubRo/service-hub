import { createContext, useContext } from 'react';
import type { MyNotice } from '../../data/notices';

export interface NoticesValue {
  /** Newest first; empty while loading or when the read failed (a notice is never in the way). */
  notices: MyNotice[];
  /** Notices not opened yet (they count on the Mesaje tab). */
  unread: number;
  /** Opened: no longer new, here at once and on every device. */
  markRead: (noticeId: string) => void;
}

export const NoticesContext = createContext<NoticesValue | null>(null);

/** Null outside the client and shop interfaces. */
export function useOptionalNotices(): NoticesValue | null {
  return useContext(NoticesContext);
}
