/**
 * Checks the two public Supabase values a build needs (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).
 * Used by the app (src/data/supabase.ts, the schema bar) and by the Netlify build (vite.config.ts),
 * which fails with this explanation instead of publishing a site that cannot reach the database.
 */
export type SupabaseConfigProblem = 'missing_url' | 'missing_key' | 'bad_url' | 'placeholder';

export type SupabaseConfig = { ok: true; url: string; key: string } | { ok: false; problem: SupabaseConfigProblem };

export function checkSupabaseConfig(rawUrl: string | undefined, rawKey: string | undefined): SupabaseConfig {
  const url = (rawUrl ?? '').trim().replace(/\/+$/, '');
  const key = (rawKey ?? '').trim();
  if (url === '') return { ok: false, problem: 'missing_url' };
  if (key === '') return { ok: false, problem: 'missing_key' };
  // The project address only: https://abcdefgh.supabase.co — no /rest/v1, no dashboard link.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, problem: 'bad_url' };
  }
  if (!/^https?:$/.test(parsed.protocol) || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    return { ok: false, problem: 'bad_url' };
  }
  if (/abcdefgh|your-project|<|cheia-anon/i.test(url + key)) return { ok: false, problem: 'placeholder' };
  return { ok: true, url: parsed.origin, key };
}

/** One line for the build log and the schema bar (English: build logs are technical). */
export function describeConfigProblem(problem: SupabaseConfigProblem): string {
  switch (problem) {
    case 'missing_url':
      return 'VITE_SUPABASE_URL is not set for this build';
    case 'missing_key':
      return 'VITE_SUPABASE_ANON_KEY is not set for this build';
    case 'bad_url':
      return 'VITE_SUPABASE_URL must be the project address only, e.g. https://abcdefgh.supabase.co';
    case 'placeholder':
      return 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY still hold the example values';
  }
}
