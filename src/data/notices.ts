import type { Notice } from './adminTools';
import { failure, RpcError } from './rpc';
import { supabase } from './supabase';

/**
 * Notices from the Service-Hub team (T16b, FR §5.9), as clients and shops see them: RLS lets each
 * person read only the notices meant for them (their role and, for a city notice, a shop in that
 * city or a client who booked there). A notice shows until the person marks it read, for 30 days.
 */

/** How long a notice stays in the app. */
export const NOTICE_DAYS = 30;

export async function fetchUnreadNotices(userId: string, now: Date = new Date()): Promise<Notice[]> {
  if (!supabase) throw new RpcError('network');
  const since = new Date(now.getTime() - NOTICE_DAYS * 86_400_000).toISOString();
  const [notices, reads] = await Promise.all([
    supabase
      .from('notices')
      .select('id, audience, city, title_ro, body_ro, title_en, body_en, send_push, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('notice_reads').select('notice_id').eq('user_id', userId),
  ]);
  if (notices.error) throw failure(notices.error);
  if (reads.error) throw failure(reads.error);
  const read = new Set(reads.data.map((r) => r.notice_id));
  return (notices.data as Notice[]).filter((n) => !read.has(n.id));
}

/** "Am citit": the notice no longer shows for this person (on every device). Harmless to repeat. */
export async function markNoticeRead(noticeId: string): Promise<void> {
  if (!supabase) throw new RpcError('network');
  const { error } = await supabase
    .from('notice_reads')
    .upsert({ notice_id: noticeId }, { onConflict: 'user_id,notice_id', ignoreDuplicates: true });
  if (error) throw failure(error);
}
