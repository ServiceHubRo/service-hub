import { describeConfigProblem } from '../lib/supabaseConfig';
import { supabase, supabaseConfig } from './supabase';

export type SchemaVersionCheck =
  | { kind: 'ok'; version: number }
  /** The build has no usable VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. */
  | { kind: 'no_config'; detail: string }
  /** The database answered with an error or did not answer (status, code, message). */
  | { kind: 'error'; detail: string };

/** Current `schema_version` of the database, or why it cannot be read. */
export async function fetchSchemaVersion(): Promise<SchemaVersionCheck> {
  if (!supabaseConfig.ok) return { kind: 'no_config', detail: describeConfigProblem(supabaseConfig.problem) };
  if (!supabase) return { kind: 'no_config', detail: 'no client' };
  try {
    const { data, error, status } = await supabase.rpc('get_schema_version');
    if (error) {
      const parts = [status ? `HTTP ${status}` : '', error.code ?? '', error.message ?? ''].filter(Boolean);
      return { kind: 'error', detail: parts.join(' · ').slice(0, 160) };
    }
    if (typeof data !== 'number') return { kind: 'error', detail: `unexpected answer: ${JSON.stringify(data)}`.slice(0, 160) };
    return { kind: 'ok', version: data };
  } catch (e) {
    return { kind: 'error', detail: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
  }
}
