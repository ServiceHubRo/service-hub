/**
 * "The server says we are no longer signed in" — raised by the data layer (an RPC answering
 * `not_signed_in`, an expired token), handled by SessionProvider, which checks and, if the session
 * is really gone, shows the sign-in panel over the current screen without losing what was typed.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onSessionLost(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reportSessionLost(): void {
  for (const listener of listeners) listener();
}

/**
 * "The session is good again" — signing in after it ended, or passing the second step (the token
 * is now aal2): screens that failed to load while it was gone load again, and the team's second
 * step is asked again when the new session has not passed it.
 */
const restoredListeners = new Set<Listener>();

export function onSessionRestored(listener: Listener): () => void {
  restoredListeners.add(listener);
  return () => restoredListeners.delete(listener);
}

export function reportSessionRestored(): void {
  for (const listener of restoredListeners) listener();
}
