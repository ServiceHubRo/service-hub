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
