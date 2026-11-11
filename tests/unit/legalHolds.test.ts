import { describe, expect, it } from 'vitest';
import { LEGAL_HOLD_BASES, reviewOverdue } from '../../src/data/legalHolds';
import { RpcError } from '../../src/data/rpc';
import { en } from '../../src/i18n/en';
import { ro } from '../../src/i18n/ro';
import { holdError } from '../../src/screens/admin/legalHoldText';

// A3c2a — legal hold of support data.

const migration = Object.values(
  import.meta.glob('../../supabase/migrations/*_legal_hold.sql', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

const appFiles = import.meta.glob('../../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const functionFiles = import.meta.glob('../../supabase/functions/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('legal hold (A3c2a)', () => {
  it('the bases in the app are exactly the database list, each with a name in both languages', () => {
    const sql = /basis in \(([^)]*)\)/.exec(migration)?.[1] ?? '';
    const inDb = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect([...LEGAL_HOLD_BASES].sort()).toEqual(inDb);
    for (const b of LEGAL_HOLD_BASES) {
      expect(Object.keys(ro)).toContain(`admin.holds.basis.${b}`);
      expect(Object.keys(en)).toContain(`admin.holds.basis.${b}`);
    }
  });

  it('no screen and no Edge Function reads the hold tables (REST, the service API, Realtime): only the admin functions do', () => {
    const touching = Object.entries({ ...appFiles, ...functionFiles })
      .filter(([path]) => !path.endsWith('database.types.ts'))
      .filter(([, text]) => /(\.from\(\s*['"`]|\.select\(\s*['"`]|rest\/v1\/|channel[^\n]*table:\s*['"`])legal_hold/.test(text))
      .map(([path]) => path);
    expect(touching).toEqual([]);
  });

  it('the app holds no privileged key: only the public URL and the publishable key reach the browser', () => {
    const offending = Object.entries(appFiles)
      .filter(([, text]) => /service_role|SERVICE_ROLE|sb_secret_|SUPABASE_SECRET|STRIPE_SECRET|sk_live_|sk_test_|whsec_/.test(text))
      .map(([path]) => path)
      .filter((path) => !path.endsWith('database.types.ts'));
    expect(offending).toEqual([]);
    const envNames = new Set<string>();
    for (const text of Object.values(appFiles)) for (const m of text.matchAll(/import\.meta\.env\.(\w+)/g)) envNames.add(m[1]!);
    for (const name of envNames) {
      expect(name.startsWith('VITE_')).toBe(true);
      expect(name).not.toMatch(/SECRET|SERVICE|PRIVATE/);
    }
  });

  it('a review is overdue only once its date passed, and never after the release', () => {
    const now = new Date('2026-11-11T12:00:00Z');
    expect(reviewOverdue({ review_due_at: '2026-11-11T11:59:00Z', released_at: null }, now)).toBe(true);
    expect(reviewOverdue({ review_due_at: '2026-11-12T00:00:00Z', released_at: null }, now)).toBe(false);
    expect(reviewOverdue({ review_due_at: '2026-11-01T00:00:00Z', released_at: '2026-11-05T00:00:00Z' }, now)).toBe(false);
  });

  it('a refusal lands on its field', () => {
    expect(holdError('ro', new RpcError('secret_in_text', { field: 'reference' }))).toEqual({
      field: 'reference',
      message: ro['rpcError.secret_in_text'],
    });
    expect(holdError('ro', new RpcError('field_invalid', { field: 'reason' })).field).toBe('reason');
    expect(holdError('en', new RpcError('field_invalid', { field: 'note' })).message).toBe(en['admin.holds.err.noteShort']);
    expect(holdError('ro', new RpcError('account_not_found')).field).toBe('account');
    expect(holdError('ro', new RpcError('hold_released')).field).toBeNull();
  });
});
