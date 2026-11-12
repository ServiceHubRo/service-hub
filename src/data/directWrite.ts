import { failure, RpcError } from './rpc';

/** What a direct delete or update with `.select('id')` answers: the rows it really changed. */
export interface ChangedRows {
  data: readonly unknown[] | null;
  error: unknown;
}

/**
 * A direct delete or update the database refuses (A6: a suspended account or shop writes nothing of
 * its own) does not fail: Row Level Security leaves the row out, no row changes and no error comes
 * back, so the screen would show the change as done (A7). When nothing changed, the row is read
 * again: still there means refused (`not_allowed`); gone means it was already deleted, and deleting
 * twice stays harmless.
 */
export async function ensureChanged(
  result: ChangedRows,
  stillThere: () => PromiseLike<ChangedRows>,
  where?: string,
): Promise<void> {
  if (result.error) throw failure(result.error, where);
  if (result.data && result.data.length > 0) return;
  const again = await stillThere();
  if (again.error) throw failure(again.error, where);
  if (again.data && again.data.length > 0) throw new RpcError('not_allowed');
}
