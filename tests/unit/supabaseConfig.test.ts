import { describe, expect, it } from 'vitest';
import { checkSupabaseConfig } from '../../src/lib/supabaseConfig';

describe('Supabase values of a build', () => {
  it('accepts the project address and a key (legacy anon or new publishable)', () => {
    expect(checkSupabaseConfig('https://xyzq1234.supabase.co', 'eyJhbGciOi.x.y')).toEqual({
      ok: true,
      url: 'https://xyzq1234.supabase.co',
      key: 'eyJhbGciOi.x.y',
    });
    expect(checkSupabaseConfig(' https://xyzq1234.supabase.co/ ', 'sb_publishable_abc')).toMatchObject({
      ok: true,
      url: 'https://xyzq1234.supabase.co',
    });
    expect(checkSupabaseConfig('http://127.0.0.1:54321', 'key')).toMatchObject({ ok: true });
  });

  it('names what is wrong', () => {
    expect(checkSupabaseConfig(undefined, 'k')).toEqual({ ok: false, problem: 'missing_url' });
    expect(checkSupabaseConfig('https://xyzq1234.supabase.co', '')).toEqual({ ok: false, problem: 'missing_key' });
    expect(checkSupabaseConfig('https://xyzq1234.supabase.co/rest/v1', 'k')).toEqual({ ok: false, problem: 'bad_url' });
    expect(checkSupabaseConfig('xyzq1234.supabase.co', 'k')).toEqual({ ok: false, problem: 'bad_url' });
    expect(checkSupabaseConfig('https://abcdefgh.supabase.co', 'cheia-anon-publică')).toEqual({ ok: false, problem: 'placeholder' });
  });
});
