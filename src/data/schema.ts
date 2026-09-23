import { supabase } from './supabase';

/** Current `schema_version` of the database, or null when it cannot be read. */
export async function fetchSchemaVersion(): Promise<number | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_schema_version');
  if (error || typeof data !== 'number') return null;
  return data;
}
