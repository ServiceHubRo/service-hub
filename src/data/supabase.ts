import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchWithTimeout } from '../lib/fetchTimeout';
import { sessionStorageForAuth } from '../lib/remember';
import { checkSupabaseConfig } from '../lib/supabaseConfig';
import type { Database } from './database.types';

/** What this build knows about its Supabase project (the schema bar explains a problem). */
export const supabaseConfig = checkSupabaseConfig(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

/**
 * An error Supabase Auth put in the address after an email link (expired or already used), read
 * before the client clears it: `#error=access_denied&error_code=otp_expired&…`.
 */
function readAuthLinkError(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return params.get('error_code') ?? params.get('error');
}
let pendingLinkError: string | null = readAuthLinkError();

/** An email-link error that reached the phone app through its own link (T20, NativeBridge). */
export function setAuthLinkError(code: string): void {
  pendingLinkError = code;
}

/** The email-link error, handed out once (the first screen that shows it consumes it). */
export function takeAuthLinkError(): string | null {
  const value = pendingLinkError;
  pendingLinkError = null;
  return value;
}

/**
 * The single Supabase client, built from the two public env vars.
 * Null when they are missing or malformed (e.g. a local build without .env) so the shell still renders.
 *
 * Email links use the implicit flow (tokens in the address), so a confirmation link opened on
 * another device or browser still works. The session is stored where "Ține-mă minte" says (in the
 * phone app, in the phone's own storage).
 */
export const supabase: SupabaseClient<Database> | null =
  supabaseConfig.ok
    ? createClient<Database>(supabaseConfig.url, supabaseConfig.key, {
        auth: {
          flowType: 'implicit',
          storage: sessionStorageForAuth,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
        // A8: a database or sign-in request with no answer fails after 30 s like a lost connection,
        // instead of leaving a screen loading or a button spinning (src/lib/fetchTimeout.ts).
        global: { fetch: fetchWithTimeout() },
      })
    : null;

// Realtime gets the new access token when signing in and at each refresh, but not after the second
// step (MFA_CHALLENGE_VERIFIED): until the next refresh (up to an hour) it would keep listening with
// the first step's token, and every row reserved to aal2 (the team's support signals, A3c1) would
// stay silent. The new token goes to Realtime at once, including channels already joined.
supabase?.auth.onAuthStateChange((event, session) => {
  if (event === 'MFA_CHALLENGE_VERIFIED' && session) void supabase?.realtime.setAuth(session.access_token);
});
