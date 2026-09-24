import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { translate, type Lang } from '../i18n/translate';
import { setRememberMe } from '../lib/remember';
import type { Role } from '../app/roles';
import { call, failure, RpcError, rpcErrorMessage } from './rpc';
import { supabase } from './supabase';

/**
 * Accounts (ARCHITECTURE §15, FR §2): sign-up, sign-in, email confirmation, password reset,
 * password and email change, data export, account deletion.
 * Failures are thrown as AuthFailure (auth server) or RpcError (database, Edge Function);
 * `authErrorMessage()` turns either into translated text. A raw server error is never shown.
 */

export type AuthFailureCode =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'email_exists'
  | 'weak_password'
  | 'rate_limited'
  | 'email_invalid'
  | 'email_not_authorized'
  | 'captcha_failed'
  | 'same_password'
  | 'signup_disabled'
  | 'wrong_current_password'
  | 'session_missing'
  | 'network'
  | 'unknown';

export class AuthFailure extends Error {
  readonly code: AuthFailureCode;
  /** For `rate_limited`: seconds until the server accepts the next try, when it says. */
  readonly seconds: number | null;

  constructor(code: AuthFailureCode, seconds: number | null = null) {
    super(code);
    this.name = 'AuthFailure';
    this.code = code;
    this.seconds = seconds;
  }
}

/** Maps whatever supabase-js Auth threw or returned to an AuthFailure. */
export function toAuthFailure(error: unknown): AuthFailure {
  if (error instanceof AuthFailure) return error;
  if (!error || typeof error !== 'object') return new AuthFailure('unknown');
  const e = error as { code?: unknown; status?: unknown; message?: unknown; name?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';

  if (e.name === 'AuthRetryableFetchError' || e.name === 'TypeError' || /failed to fetch|networkerror|load failed/i.test(message)) {
    return new AuthFailure('network');
  }
  if (e.name === 'AuthSessionMissingError') return new AuthFailure('session_missing');

  switch (e.code) {
    case 'invalid_credentials':
      return new AuthFailure('invalid_credentials');
    case 'email_not_confirmed':
      return new AuthFailure('email_not_confirmed');
    case 'user_already_exists':
    case 'email_exists':
      return new AuthFailure('email_exists');
    case 'weak_password':
      return new AuthFailure('weak_password');
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit': {
      const seconds = /(\d+)\s*seconds?/i.exec(message);
      return new AuthFailure('rate_limited', seconds ? Math.max(1, Number(seconds[1])) : null);
    }
    case 'email_address_invalid':
      return new AuthFailure('email_invalid');
    case 'email_address_not_authorized':
      return new AuthFailure('email_not_authorized');
    case 'captcha_failed':
      return new AuthFailure('captcha_failed');
    case 'same_password':
      return new AuthFailure('same_password');
    case 'signup_disabled':
    case 'email_provider_disabled':
      return new AuthFailure('signup_disabled');
    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
    case 'bad_jwt':
    case 'user_not_found':
      return new AuthFailure('session_missing');
  }
  if (e.status === 429) return new AuthFailure('rate_limited');
  if (e.code === 'validation_failed' && /email/i.test(message)) return new AuthFailure('email_invalid');
  return new AuthFailure('unknown');
}

/** Translated text for any error thrown by the functions in this file. */
export function authErrorMessage(lang: Lang, error: unknown): string {
  if (error instanceof RpcError) return rpcErrorMessage(lang, error);
  const failure = toAuthFailure(error);
  if (failure.code === 'network') return translate(lang, 'action.error');
  if (failure.code === 'rate_limited' && failure.seconds !== null && failure.seconds < 3600) {
    return translate(lang, 'auth.error.rate_limited_seconds', { seconds: failure.seconds });
  }
  return translate(lang, `auth.error.${failure.code}`);
}

/** Only network failures are worth an immediate "Încearcă din nou". */
export function isRetryable(error: unknown): boolean {
  if (error instanceof RpcError) return error.code === 'network' || error.code === 'unknown';
  const code = toAuthFailure(error).code;
  return code === 'network' || code === 'unknown';
}

// ------------------------------------------------------------------------------------ plumbing

function auth() {
  if (!supabase) throw new AuthFailure('network');
  return supabase.auth;
}

function origin(): string {
  return window.location.origin;
}

/** Where email links land. Supabase Auth must list these under Redirect URLs (PR "Pașii tăi"). */
export const LINK_TARGETS = {
  confirm: () => `${origin()}/`,
  reset: () => `${origin()}/parola-noua`,
  emailChange: () => `${origin()}/`,
};

async function run<T extends { error: unknown }>(promise: Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await promise;
  } catch (e) {
    throw toAuthFailure(e);
  }
  if (result.error) throw toAuthFailure(result.error);
  return result;
}

// ------------------------------------------------------------------------------------ sign-in / sign-up

export async function signIn(email: string, password: string, remember: boolean, captchaToken?: string): Promise<void> {
  setRememberMe(remember);
  await run(auth().signInWithPassword({ email: email.trim(), password, options: { captchaToken } }));
}

export interface SignUpInput {
  role: Exclude<Role, 'admin'>;
  name: string;
  phone: string;
  email: string;
  password: string;
  lang: Lang;
  termsVersion: string;
  shopName?: string;
  city?: string;
  captchaToken?: string;
}

/** 'confirm_email' when the account waits for the email link (the normal case). */
export async function signUp(input: SignUpInput): Promise<'confirm_email' | 'signed_in'> {
  setRememberMe(true);
  const { data } = await run(
    auth().signUp({
      email: input.email.trim(),
      password: input.password,
      options: {
        emailRedirectTo: LINK_TARGETS.confirm(),
        captchaToken: input.captchaToken,
        // Read by the sign-up trigger (handle_new_user); the role can only be client or shop.
        data: {
          role: input.role,
          name: input.name.trim(),
          phone: input.phone,
          lang: input.lang,
          terms_version: input.termsVersion,
          ...(input.role === 'shop' ? { shop_name: input.shopName?.trim(), city: input.city?.trim() } : {}),
        },
      },
    }),
  );
  // With email confirmation on, Supabase answers an existing address with a user without
  // identities instead of an error (so nobody can probe addresses); that is our "already exists".
  if (data.user && (data.user.identities?.length ?? 0) === 0) throw new AuthFailure('email_exists');
  return data.session ? 'signed_in' : 'confirm_email';
}

export async function resendConfirmation(email: string, captchaToken?: string): Promise<void> {
  await run(
    auth().resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: LINK_TARGETS.confirm(), captchaToken } }),
  );
}

/**
 * Sends the reset link. Always ends the same way whether the address exists or not (FR §2):
 * only a network or CAPTCHA problem is reported, because only those are the user's to fix.
 */
export async function requestPasswordReset(email: string, captchaToken?: string): Promise<void> {
  try {
    await run(auth().resetPasswordForEmail(email.trim(), { redirectTo: LINK_TARGETS.reset(), captchaToken }));
  } catch (e) {
    const failure = toAuthFailure(e);
    if (failure.code === 'network' || failure.code === 'captcha_failed') throw failure;
  }
}

/** New password from the reset link (the link signed the user in). */
export async function setNewPassword(password: string): Promise<void> {
  await run(auth().updateUser({ password }));
}

/** Signs out on this device only; other devices stay signed in. */
export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut({ scope: 'local' });
}

// ------------------------------------------------------------------------------------ Cont

/** Checks the current password by signing in again, then sets the new one. */
export async function changePassword(email: string, current: string, next: string, captchaToken?: string): Promise<void> {
  try {
    await run(auth().signInWithPassword({ email, password: current, options: { captchaToken } }));
  } catch (e) {
    const failure = toAuthFailure(e);
    throw failure.code === 'invalid_credentials' ? new AuthFailure('wrong_current_password') : failure;
  }
  await run(auth().updateUser({ password: next }));
}

/** Starts an email change; the new address works only after it is confirmed. */
export async function changeEmail(newEmail: string): Promise<void> {
  await run(auth().updateUser({ email: newEmail.trim() }, { emailRedirectTo: LINK_TARGETS.emailChange() }));
}

/** Drops the pending email change; the links already sent stop working. */
export async function cancelEmailChange(requestId: string): Promise<void> {
  await call('cancel_email_change', { p_request_id: requestId });
  // Fetches the user again so `new_email` disappears from the session.
  await run(auth().refreshSession());
}

/** "Descarcă datele mele": everything the account holds, as JSON. */
export async function exportMyData(): Promise<unknown> {
  return call('export_my_data', {} as never);
}

/** "Șterge contul" — Edge Function `delete-account`. Refusals arrive as RpcError codes. */
export async function deleteAccount(): Promise<void> {
  if (!supabase) throw new RpcError('network');
  const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (!error) return;
  if (error instanceof FunctionsFetchError) throw new RpcError('network');
  if (error instanceof FunctionsHttpError) {
    let code: unknown;
    try {
      code = ((await (error.context as Response).json()) as { error?: unknown }).error;
    } catch {
      code = null;
    }
    throw failure({ message: code });
  }
  throw new RpcError('unknown');
}
