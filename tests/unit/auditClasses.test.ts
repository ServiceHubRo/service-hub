import { describe, expect, it } from 'vitest';
import { AUDIT_CLASSES, REPORT_KINDS } from '../../src/data/retention';
import { en } from '../../src/i18n/en';
import { ro } from '../../src/i18n/ro';
import { AUDIT_ACTIONS } from '../../src/lib/admin';

// A3c2b2 — every action written to the audit log has a class (and so a retention period). A new action
// without one fails here until it is added to audit_action_classes in a migration.

const migrations = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const classesSql = Object.entries(migrations).find(([path]) => path.endsWith('_audit_log_retention.sql'))![1];

// The classes are set where the table was created (A3c2b2) and by every later migration that adds actions
// to it (A4 onwards): each `insert into public.audit_action_classes` block counts.
const classInserts = Object.values(migrations).flatMap((sql) =>
  [...sql.matchAll(/insert into public\.audit_action_classes \(action, class, strip_keys\) values([\s\S]*?);/g)].map((m) => m[1]!),
);
const classified = new Map(
  classInserts.flatMap((block) =>
    [...block.matchAll(/\('([a-z_]+)', '(support|admin|security|legal)', '\{[a-z_,]*\}'\)/g)].map((m) => [m[1]!, m[2]!] as const),
  ),
);

/** Every action a migration writes: the audit helpers' literals, the direct inserts, the CASE choices. */
function writtenActions(): Set<string> {
  const out = new Set<string>();
  for (const sql of Object.values(migrations)) {
    for (const m of sql.matchAll(/(?:staff_audit|admin_audit|admin_audit_key)\(\s*'([a-z_]+)'/g)) out.add(m[1]!);
    for (const m of sql.matchAll(/insert into public\.admin_audit_log\s*\([^)]*\)\s*values\s*\(\s*[^,]+,\s*'([a-z_]+)'/g)) out.add(m[1]!);
    for (const m of sql.matchAll(/admin_audit(?:_key)?\(\s*case when [^']*'([a-z_]+)' else '([a-z_]+)' end/g)) {
      out.add(m[1]!);
      out.add(m[2]!);
    }
  }
  return out;
}

describe('audit log classes (A3c2b2)', () => {
  it('every action a migration writes has a class', () => {
    const missing = [...writtenActions()].filter((a) => !classified.has(a));
    expect(missing).toEqual([]);
  });

  it('every action the admin screens name has a class', () => {
    expect(AUDIT_ACTIONS.filter((a) => !classified.has(a))).toEqual([]);
  });

  it('the support actions are the support team’s; legal hold actions their own class', () => {
    expect(classified.get('support_search')).toBe('support');
    expect(classified.get('open_request_file')).toBe('support');
    expect(classified.get('place_legal_hold')).toBe('legal');
    expect(classified.get('delete_account')).toBe('security');
    expect(classified.get('grant_support')).toBe('security');
    // A4: the Help Center's administration is administrative.
    expect(classified.get('publish_help_article')).toBe('admin');
    expect(classified.get('move_help_item')).toBe('admin');
  });

  it('every class and every report kind has words in both languages', () => {
    for (const k of AUDIT_CLASSES) {
      expect(ro).toHaveProperty([`admin.retention.class.${k}`]);
      expect(en).toHaveProperty([`admin.retention.class.${k}`]);
    }
    for (const k of REPORT_KINDS) {
      expect(ro).toHaveProperty([`admin.retention.report.kind.${k}`]);
      expect(en).toHaveProperty([`admin.retention.report.kind.${k}`]);
    }
  });

  it('the administrative log job is created locked, for the legal validation', () => {
    expect(classesSql).toMatch(/\('admin_log', 'legal_validation'\)/);
  });
});
