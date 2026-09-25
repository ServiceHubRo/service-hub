import { createContext, useContext } from 'react';

export interface AdminCounts {
  /** Reported reviews waiting for a decision (the badge on Moderare); null until known. */
  pendingReports: number | null;
}

export const AdminCountsContext = createContext<AdminCounts | null>(null);

/** The admin counters, or null outside the admin interface. */
export function useOptionalAdminCounts(): AdminCounts | null {
  return useContext(AdminCountsContext);
}
