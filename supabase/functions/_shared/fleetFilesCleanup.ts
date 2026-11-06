// The daily cleanup of incident photos that were uploaded and never attached to a report (M3).
//
// Candidates come from the database (fleet_issue_photo_orphans: exact issue paths only, older than
// 48 hours, attached to no report). Here the path is checked again against the same pattern, and each
// photo is confirmed again as an orphan right before it is deleted (fleet_issue_photo_orphan). A
// receipt (`<company>/<vehicle>/<file>`) can never match. A delete that fails is left for the next day;
// two runs at once are harmless (deleting a file that is already gone is not an error).

/** `<company uuid>/<vehicle uuid>/issues/<issue uuid>/<file>`, the same pattern as fleet_issue_path(). */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const ISSUE_PHOTO_PATH = new RegExp(`^${UUID}/${UUID}/issues/${UUID}/[A-Za-z0-9._-]{1,120}$`);

export interface CleanupApi {
  /** The candidates (service role). */
  orphans(limit: number): Promise<string[]>;
  /** Still an orphan right now (service role). */
  isOrphan(name: string): Promise<boolean>;
  /** Deletes through the Storage API; throws when the request fails. */
  remove(names: string[]): Promise<void>;
}

export interface CleanupResult {
  listed: number;
  deleted: number;
  skipped: number;
  failed: number;
}

export async function cleanupFleetFiles(api: CleanupApi, limit = 500): Promise<CleanupResult> {
  const listed = await api.orphans(limit);
  const result: CleanupResult = { listed: listed.length, deleted: 0, skipped: 0, failed: 0 };
  for (const name of listed) {
    if (!ISSUE_PHOTO_PATH.test(name)) {
      result.skipped += 1;
      continue;
    }
    try {
      if (!(await api.isOrphan(name))) {
        result.skipped += 1;
        continue;
      }
      await api.remove([name]);
      result.deleted += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
