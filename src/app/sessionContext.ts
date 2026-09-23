import { createContext, useContext } from 'react';
import type { Role } from './roles';

export interface SessionValue {
  role: Role | null;
  /** Test builds only, until real accounts arrive in T04. */
  setDevRole: (role: Role) => void;
  signOut: () => void;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
