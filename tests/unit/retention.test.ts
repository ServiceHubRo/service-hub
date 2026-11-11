import { describe, expect, it } from 'vitest';
import { FINDING_KINDS, findingList, RETENTION_JOBS, reviewDaysLeft, reviewUrgent } from '../../src/data/retention';
import { en } from '../../src/i18n/en';
import { ro } from '../../src/i18n/ro';

// A3c2b1 — retention of support data: the app's view of the jobs and of the suggestions' review.

const migration = Object.values(
  import.meta.glob('../../supabase/migrations/*_support_retention.sql', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

const appFiles = import.meta.glob('../../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('retention (A3c2b1)', () => {
  it('days left before a review text is deleted, and the last 7 days', () => {
    const now = new Date('2026-11-11T10:00:00Z');
    expect(reviewDaysLeft('2026-12-11T10:00:00Z', now)).toBe(30);
    expect(reviewDaysLeft('2026-11-12T09:59:00Z', now)).toBe(0);
    expect(reviewDaysLeft('2026-11-01T00:00:00Z', now)).toBe(0);
    expect(reviewUrgent('2026-11-18T10:00:00Z', now)).toBe(true);
    expect(reviewUrgent('2026-11-18T10:01:00Z', now)).toBe(false);
  });

  it('the findings in a fixed order, only those found', () => {
    expect(findingList({ phone: 2, email: 1, vin: 0 })).toEqual([
      { kind: 'email', n: 1 },
      { kind: 'phone', n: 2 },
    ]);
  });

  it('every kind the database finds has words in both languages, and only those', () => {
    const inDb = [...migration.matchAll(/array\['([a-z_]+)', '/g)].map((m) => m[1]);
    const extra = ['cnp', 'card', 'secret'];
    expect(new Set(FINDING_KINDS)).toEqual(new Set([...inDb, ...extra]));
    for (const k of FINDING_KINDS) {
      expect(ro).toHaveProperty([`support.textReview.kind.${k}`]);
      expect(en).toHaveProperty([`support.textReview.kind.${k}`]);
    }
  });

  it('every job has its name and its rule in both languages', () => {
    for (const j of RETENTION_JOBS) {
      for (const key of [`admin.retention.job.${j}`, `admin.retention.rule.${j}`, `admin.retention.eligible.${j}`]) {
        expect(ro).toHaveProperty([key]);
        expect(en).toHaveProperty([key]);
      }
    }
  });

  it('the jobs start off and nothing in the app reads the retention tables directly', () => {
    expect(migration).toMatch(/enabled boolean not null default false/);
    expect(migration).not.toMatch(/insert into public\.retention_jobs[^;]*true/i);
    const offenders = Object.entries(appFiles)
      .filter(([, src]) => /from\(['"](retention_jobs|retention_runs|support_stats_monthly|suggestions_anonymous)['"]\)/.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
