import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * The single Supabase client, built from the two public env vars.
 * Null when they are missing (e.g. a local build without .env) so the shell still renders.
 * The "Remember me" storage adapter arrives with accounts in T04.
 */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;
