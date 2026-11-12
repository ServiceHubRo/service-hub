import { beforeEach, describe, expect, it, vi } from 'vitest';

// A7: a direct delete the database refuses (A6, suspended account or shop) changes no row and
// returns no error. The screens must show an error, never a success.
const db = vi.hoisted(() => ({
  // Rows the delete answers (what it really deleted) and rows a read finds afterwards.
  deleted: [] as { id: string }[],
  remaining: [] as { id: string }[],
  deleteError: null as unknown,
  calls: [] as string[],
}));

vi.mock('../../src/data/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      delete: () => ({
        eq: (_col: string, id: string) => ({
          select: async () => {
            db.calls.push(`delete ${table} ${id}`);
            return db.deleteError ? { data: null, error: db.deleteError } : { data: db.deleted, error: null };
          },
        }),
      }),
      select: () => ({
        eq: async (_col: string, id: string) => {
          db.calls.push(`read ${table} ${id}`);
          return { data: db.remaining, error: null };
        },
      }),
    }),
  },
}));

const { ensureChanged } = await import('../../src/data/directWrite');
const { deleteCar } = await import('../../src/data/garage');
const { removeStaff, deleteClosure } = await import('../../src/data/shop');
const { RpcError } = await import('../../src/data/rpc');

beforeEach(() => {
  db.deleted = [];
  db.remaining = [];
  db.deleteError = null;
  db.calls = [];
});

describe('ensureChanged', () => {
  it('accepts a write that changed a row, without reading again', async () => {
    const again = vi.fn();
    await expect(ensureChanged({ data: [{ id: 'a' }], error: null }, again)).resolves.toBeUndefined();
    expect(again).not.toHaveBeenCalled();
  });

  it('refuses when nothing changed and the row is still there', async () => {
    const result = ensureChanged({ data: [], error: null }, async () => ({ data: [{ id: 'a' }], error: null }));
    await expect(result).rejects.toBeInstanceOf(RpcError);
    await expect(result).rejects.toMatchObject({ code: 'not_allowed' });
  });

  it('accepts when the row was already gone (deleting twice stays harmless)', async () => {
    await expect(ensureChanged({ data: [], error: null }, async () => ({ data: [], error: null }))).resolves.toBeUndefined();
  });

  it('passes a database error on as an error', async () => {
    await expect(ensureChanged({ data: null, error: { code: 'P0001', message: 'account_suspended' } }, async () => ({ data: [], error: null }))).rejects.toMatchObject({
      code: 'account_suspended',
    });
  });
});

describe('the screens that delete directly', () => {
  const cases: [string, (id: string) => Promise<void>, string][] = [
    ['a car from the garage', deleteCar, 'cars'],
    ['a colleague of the shop', removeStaff, 'shop_staff'],
    ['a closed period', deleteClosure, 'shop_closures'],
  ];

  for (const [what, remove, table] of cases) {
    it(`never report ${what} as deleted while it is still there`, async () => {
      db.remaining = [{ id: 'x1' }];
      await expect(remove('x1')).rejects.toMatchObject({ code: 'not_allowed' });
      expect(db.calls).toEqual([`delete ${table} x1`, `read ${table} x1`]);
    });

    it(`delete ${what}`, async () => {
      db.deleted = [{ id: 'x1' }];
      await expect(remove('x1')).resolves.toBeUndefined();
      expect(db.calls).toEqual([`delete ${table} x1`]);
    });
  }
});
