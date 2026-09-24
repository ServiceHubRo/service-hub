import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authStorage } from '../lib/remember';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

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

/** The email-link error, handed out once (the first screen that shows it consumes it). */
export function takeAuthLinkError(): string | null {
  const value = pendingLinkError;
  pendingLinkError = null;
  return value;
}

/**
 * The single Supabase client, built from the two public env vars.
 * Null when they are missing (e.g. a local build without .env) so the shell still renders.
 *
 * Email links use the implicit flow (tokens in the address), so a confirmation link opened on
 * another device or browser still works. The session is stored where "Ține-mă minte" says.
 */
export const supabase: SupabaseClient<Database> | null =
  url && anonKey
    ? createClient<Database>(url, anonKey, {
        auth: {
          flowType: 'implicit',
          storage: authStorage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;
