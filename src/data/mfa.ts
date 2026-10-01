import { RpcError } from './rpc';
import { supabase } from './supabase';

/**
 * The second step of sign-in for admins (T25): a 6-digit code from an authenticator app (TOTP,
 * Supabase Auth MFA). The database gives admin powers only to a session that passed it (aal2), so
 * this is the protection, not the screen.
 */

function auth() {
  if (!supabase) throw new RpcError('network');
  return supabase.auth;
}

export type MfaState =
  /** Passed the second step: admin powers. */
  | { step: 'done' }
  /** Has an authenticator app: type its code. */
  | { step: 'challenge'; factorId: string }
  /** No authenticator app yet: set one up. */
  | { step: 'enroll' };

export async function mfaState(): Promise<MfaState> {
  const a = auth();
  const { data, error } = await a.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw new RpcError('network');
  if (data.currentLevel === 'aal2') return { step: 'done' };
  const factors = await a.mfa.listFactors();
  if (factors.error) throw new RpcError('network');
  const verified = factors.data.totp.find((f) => f.status === 'verified');
  return verified ? { step: 'challenge', factorId: verified.id } : { step: 'enroll' };
}

export interface Enrollment {
  factorId: string;
  /** An SVG image (data: URL) to scan. */
  qr: string;
  /** The same key, to type by hand. */
  secret: string;
}

/** A new authenticator app; an unfinished earlier setup is dropped first. */
export async function startEnrollment(): Promise<Enrollment> {
  const a = auth();
  const factors = await a.mfa.listFactors();
  if (factors.error) throw new RpcError('network');
  for (const f of factors.data.all) {
    if (f.status !== 'verified') await a.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await a.mfa.enroll({ factorType: 'totp', friendlyName: 'Service-Hub' });
  if (error || !data) throw new RpcError('network');
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Checks a code. False for a wrong or expired code; the session becomes aal2 when true. */
export async function verifyCode(factorId: string, code: string): Promise<boolean> {
  const { error } = await auth().mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
  if (!error) return true;
  const e = error as { status?: number; code?: string };
  // Signed out meanwhile (another device of this admin passed the second step, which ends the
  // sessions still waiting for it): sign in again.
  if (e.code === 'session_not_found' || e.status === 401 || e.status === 403) throw new RpcError('not_signed_in');
  if (e.status === 400 || e.status === 422) return false;
  throw new RpcError('network');
}
