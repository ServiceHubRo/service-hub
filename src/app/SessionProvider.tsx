import type { Session, User } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { signOut as authSignOut } from '../data/auth';
import { fetchProfile, updateLang, type Profile } from '../data/profile';
import { forgetPushDevice } from '../data/push';
import { onSessionLost } from '../data/sessionEvents';
import { supabase } from '../data/supabase';
import { useI18n } from '../i18n/context';
import type { Lang } from '../i18n/translate';
import { inactiveTooLong, markSeen, rememberMe } from '../lib/remember';
import type { Role } from './roles';
import { SessionContext, type SessionStatus, type SessionValue } from './sessionContext';

interface State {
  status: SessionStatus;
  user: User | null;
  profile: Profile | null;
}

/**
 * Supabase Auth session → the signed-in user, their profile and role (ARCHITECTURE §15).
 * The role comes only from the profile row, never from anything the browser can change.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { lang, setLang } = useI18n();
  const [state, setStateRaw] = useState<State>(() => ({
    status: supabase ? 'loading' : 'signedOut',
    user: null,
    profile: null,
  }));
  // The latest state for the auth callbacks, which outlive renders.
  const stateRef = useRef(state);
  const setState = useCallback((next: State) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);
  const leavingRef = useRef(false); // true while the user signs out on purpose
  const loadedForRef = useRef<string | null>(null); // user id whose profile is loaded / loading
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  const loadProfile = useCallback(
    async (user: User) => {
      loadedForRef.current = user.id;
      try {
        const profile = await fetchProfile(user.id);
        if (loadedForRef.current !== user.id) return;
        if (!profile || profile.deleted_at) {
          loadedForRef.current = null;
          await authSignOut();
          setState({ status: 'signedOut', user: null, profile: null });
          return;
        }
        // After login the language saved on the profile wins.
        if (profile.lang !== langRef.current) setLang(profile.lang as Lang);
        setState({ status: 'signedIn', user, profile });
      } catch {
        if (loadedForRef.current === user.id) setState({ status: 'error', user, profile: null });
      }
    },
    [setLang, setState],
  );

  const handleSession = useCallback(
    (event: string, session: Session | null) => {
      const current = stateRef.current;
      if (!session) {
        loadedForRef.current = null;
        const involuntary = !leavingRef.current && current.profile && event === 'SIGNED_OUT';
        leavingRef.current = false;
        setState(
          involuntary
            ? { status: 'expired', user: current.user, profile: current.profile }
            : { status: 'signedOut', user: null, profile: null },
        );
        return;
      }
      const user = session.user;
      if (event === 'INITIAL_SESSION' && rememberMe() && inactiveTooLong()) {
        // 30 days without using the app on this device: sign in again.
        void authSignOut();
        return;
      }
      markSeen();
      if (loadedForRef.current === user.id && current.profile?.id === user.id) {
        // Token refresh or user update: keep the profile, take the fresh user (email, new_email).
        setState({ status: 'signedIn', user, profile: current.profile });
        if (event === 'USER_UPDATED') void loadProfile(user);
        return;
      }
      if (loadedForRef.current !== user.id) {
        if (current.status !== 'expired') setState({ status: 'loading', user, profile: null });
        void loadProfile(user);
      }
    },
    [loadProfile, setState],
  );

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    // Supabase warns against awaiting its own calls inside this callback; defer the work.
    const { data } = client.auth.onAuthStateChange((event, session) => {
      window.setTimeout(() => handleSession(event, session), 0);
    });
    const stopLost = onSessionLost(() => {
      // The server refused our token: check whether the session is really gone.
      void client.auth.getUser().then(({ data: fresh, error }) => {
        if (error || !fresh.user) void client.auth.signOut({ scope: 'local' });
      });
    });
    const seen = () => {
      if (document.visibilityState === 'visible' && stateRef.current.status === 'signedIn') markSeen();
    };
    document.addEventListener('visibilitychange', seen);
    return () => {
      data.subscription.unsubscribe();
      stopLost();
      document.removeEventListener('visibilitychange', seen);
    };
  }, [handleSession]);

  const signOut = useCallback(async () => {
    leavingRef.current = true;
    loadedForRef.current = null;
    // While still signed in: this device stops getting the leaving person's notifications.
    await forgetPushDevice();
    await authSignOut();
    setState({ status: 'signedOut', user: null, profile: null });
  }, [setState]);

  const refreshProfile = useCallback(async () => {
    const user = stateRef.current.user;
    if (user) await loadProfile(user);
  }, [loadProfile]);

  const setProfile = useCallback(
    (profile: Profile) => {
      const current = stateRef.current;
      if (current.user && current.user.id === profile.id) setState({ ...current, profile });
    },
    [setState],
  );

  const setLanguage = useCallback(
    (next: Lang) => {
      setLang(next);
      const current = stateRef.current;
      if (current.status === 'signedIn' && current.profile && current.profile.lang !== next) {
        const profile = { ...current.profile, lang: next };
        setState({ ...current, profile });
        // Best effort: the interface already switched; the next change retries the save.
        updateLang(profile.id, next).catch(() => undefined);
      }
    },
    [setLang, setState],
  );

  const value = useMemo<SessionValue>(
    () => ({
      status: state.status,
      user: state.user,
      profile: state.profile,
      role: (state.profile?.role as Role | undefined) ?? null,
      emailVerified: Boolean(state.profile?.email_verified_at),
      signOut,
      refreshProfile,
      setProfile,
      setLanguage,
    }),
    [state, signOut, refreshProfile, setProfile, setLanguage],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
