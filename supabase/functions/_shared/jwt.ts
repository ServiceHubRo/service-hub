// Reading an access token's claims (T25). Pure, so the unit tests import it too.

/**
 * The assurance level of an access token: `aal2` after the second step of sign-in (T25), else
 * `aal1`. Read from the token's payload without checking its signature: call it only for a token
 * the Auth server has just accepted (userFromToken).
 */
export function tokenAal(token: string | null): 'aal1' | 'aal2' {
  const part = token?.split('.')[1];
  if (!part) return 'aal1';
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { aal?: unknown };
    return payload.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch {
    return 'aal1';
  }
}

/**
 * The session an access token belongs to (its `session_id` claim), or null. Like tokenAal, only for a
 * token the Auth server has just accepted. A support agent's session must still exist (A2).
 */
export function tokenSession(token: string | null): string | null {
  const part = token?.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { session_id?: unknown };
    return typeof payload.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(payload.session_id) ? payload.session_id : null;
  } catch {
    return null;
  }
}
