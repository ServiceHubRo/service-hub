import { describe, expect, it } from 'vitest';
import { cleanupFleetFiles, ISSUE_PHOTO_PATH, type CleanupApi } from '../../supabase/functions/_shared/fleetFilesCleanup';

const CO = '11111111-1111-4111-8111-111111111111';
const VEH = '22222222-2222-4222-8222-222222222222';
const ISSUE = '33333333-3333-4333-8333-333333333333';
const photo = (f: string) => `${CO}/${VEH}/issues/${ISSUE}/${f}`;
const receipt = `${CO}/${VEH}/bon.jpg`;

/** A storage stand-in: files, which are attached, and deletes that fail once. */
function store(files: string[], opts: { attached?: string[]; failOnce?: string[] } = {}) {
  const present = new Set(files);
  const attached = new Set(opts.attached ?? []);
  const failOnce = new Set(opts.failOnce ?? []);
  const api: CleanupApi = {
    orphans: async () => [...present].filter((f) => !attached.has(f)),
    isOrphan: async (name) => present.has(name) && !attached.has(name),
    remove: async (names) => {
      for (const n of names) {
        if (failOnce.delete(n)) throw new Error('storage 500');
        present.delete(n);
      }
    },
  };
  return { api, present, attached };
}

describe('fleet-files cleanup (M3)', () => {
  it('the path pattern takes issue photos only, never a receipt', () => {
    expect(ISSUE_PHOTO_PATH.test(photo('a.jpg'))).toBe(true);
    expect(ISSUE_PHOTO_PATH.test(receipt)).toBe(false);
    expect(ISSUE_PHOTO_PATH.test(`${CO}/${VEH}/issues/${ISSUE}/sub/a.jpg`)).toBe(false);
    expect(ISSUE_PHOTO_PATH.test(`../${CO}/${VEH}/issues/${ISSUE}/a.jpg`)).toBe(false);
  });

  it('a receipt listed by mistake is never deleted', async () => {
    const s = store([receipt, photo('a.jpg')]);
    const r = await cleanupFleetFiles(s.api);
    expect(s.present.has(receipt)).toBe(true);
    expect(s.present.has(photo('a.jpg'))).toBe(false);
    expect(r).toEqual({ listed: 2, deleted: 1, skipped: 1, failed: 0 });
  });

  it('a photo attached between the listing and the delete is kept (checked again)', async () => {
    const s = store([photo('a.jpg'), photo('b.jpg')]);
    const api: CleanupApi = {
      ...s.api,
      orphans: async () => {
        const list = await s.api.orphans(10);
        s.attached.add(photo('b.jpg'));
        return list;
      },
    };
    await cleanupFleetFiles(api);
    expect(s.present.has(photo('b.jpg'))).toBe(true);
  });

  it('13: a delete that fails is retried the next day; the rest is deleted', async () => {
    const s = store([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')], { failOnce: [photo('b.jpg')] });
    const first = await cleanupFleetFiles(s.api);
    expect(first).toMatchObject({ deleted: 2, failed: 1 });
    expect([...s.present]).toEqual([photo('b.jpg')]);
    const next = await cleanupFleetFiles(s.api);
    expect(next).toMatchObject({ deleted: 1, failed: 0 });
    expect(s.present.size).toBe(0);
  });

  it('14: two runs at once: no error, each photo deleted once', async () => {
    const s = store([photo('a.jpg'), photo('b.jpg')]);
    const removed: string[] = [];
    const api: CleanupApi = {
      ...s.api,
      remove: async (names) => {
        for (const n of names) if (s.present.has(n)) removed.push(n);
        await s.api.remove(names);
      },
    };
    const [a, b] = await Promise.all([cleanupFleetFiles(api), cleanupFleetFiles(api)]);
    expect(a.failed + b.failed).toBe(0);
    expect(removed.sort()).toEqual([photo('a.jpg'), photo('b.jpg')]);
    expect(s.present.size).toBe(0);
  });
});
