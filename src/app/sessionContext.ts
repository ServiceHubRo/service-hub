import type { User } from '@supabase/supabase-js';
import { createContext, useContext } from 'react';
import type { Profile } from '../data/profile';
import type { Lang } from '../i18n/translate';
import type { Role } from './roles';

/**
 *   loading   — reading the stored session / the profile
 *   signedOut — nobody signed in
 *   signedIn  — user + profile loaded
 *   expired   — the session ended by itself while the app was open; the screen stays as it was
 *               and a sign-in panel covers it (nothing typed is lost)
 *   error     — the profile could not be loaded (offline); retry
 */
export type SessionStatus = 'loading' | 'signedOut' | 'signedIn' | 'expired' | 'error';

export interface SessionValue {
  status: SessionStatus;
  user: User | null;
  profile: Profile | null;
  role: Role | null;
  emailVerified: boolean;
  /** Signs out on this device only. */
  signOut: () => Promise<void>;
  /** Reloads the profile (after an edit elsewhere or a failed load). */
  refreshProfile: () => Promise<void>;
  /** Replaces the profile with a freshly saved one. */
  setProfile: (profile: Profile) => void;
  /** Changes the interface language and, when signed in, saves it on the profile. */
  setLanguage: (lang: Lang) => void;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
