// fleet-files-cleanup — deletes incident photos uploaded and never attached to a report (M3).
//
// Posted once a day by the database (kick_fleet_files_cleanup, pg_cron) with the dispatcher's
// x-dispatch-token; refused without it. The logic and its safeguards: _shared/fleetFilesCleanup.ts.
import { adminApi } from '../_shared/admin.ts';
import { cleanupFleetFiles } from '../_shared/fleetFilesCleanup.ts';
import { json } from '../_shared/http.ts';
import { reportError } from '../_shared/monitor.ts';

const BUCKET = 'fleet-files';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'not_allowed' }, 405);
  try {
    const api = adminApi();
    const token = req.headers.get('x-dispatch-token');
    if (!token || !(await api.rpc('is_dispatch_token', { p_token: token }))) return json({ error: 'not_allowed' }, 403);
    const result = await cleanupFleetFiles({
      orphans: async (limit) => ((await api.rpc('fleet_issue_photo_orphans', { p_limit: limit })) ?? []) as string[],
      isOrphan: async (name) => (await api.rpc('fleet_issue_photo_orphan', { p_name: name })) === true,
      remove: (names) => api.remove(BUCKET, names),
    });
    return json(result);
  } catch (e) {
    await reportError('fleet-files-cleanup', e);
    return json({ error: 'unknown' }, 500);
  }
});
