import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { IS_TEST_BUILD } from '../lib/env';
import { storage } from '../lib/storage';
import { roleFromParam, type Role } from './roles';
import { SessionContext, type SessionValue } from './sessionContext';

const DEV_ROLE_KEY = 'sh_dev_role';

// T01: the role comes from the test-only `?rol=` switch. T04 replaces this with Supabase Auth.
function initialRole(): Role | null {
  return IS_TEST_BUILD ? roleFromParam(storage.get(DEV_ROLE_KEY)) : null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(initialRole);

  const setDevRole = useCallback((next: Role) => {
    if (!IS_TEST_BUILD) return;
    storage.set(DEV_ROLE_KEY, next);
    setRole(next);
  }, []);

  const signOut = useCallback(() => {
    storage.remove(DEV_ROLE_KEY);
    setRole(null);
  }, []);

  const value = useMemo<SessionValue>(() => ({ role, setDevRole, signOut }), [role, setDevRole, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
