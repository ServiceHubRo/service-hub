import type { JsonParams } from '../lib/messages';
import { call, failure, RpcError } from './rpc';
import { supabase } from './supabase';

/**
 * Conversations (FR §3.7, §4.4; T11). The list is one read, `list_threads()`, which answers only
 * with the caller's own threads (a client's, or their shop's) with the last message and the
 * unread count. The messages of one thread are read straight from the table (RLS: the thread's
 * client, its shop's members, admin). Sending and read markers go through `send_message` and
 * `mark_thread_read` (src/data/rpc.ts).
 */

export interface ThreadSummary {
  thread_id: string;
  shop_id: string;
  /** Null when the client deleted the account. */
  client_id: string | null;
  shop_name: string;
  shop_logo_url: string | null;
  client_name: string | null;
  last_message_at: string | null;
  last_kind: 'user' | 'system' | null;
  last_body: string | null;
  last_event: string | null;
  last_params: JsonParams | null;
  /** The last message belongs to the reader's side ("Tu: …"). */
  last_own: boolean | null;
  unread: number;
}

export interface ThreadsData {
  threads: ThreadSummary[];
  /** The shop whose threads these are (shop side), for the live subscription. */
  shopId: string | null;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  kind: 'user' | 'system';
  sender_id: string | null;
  body: string | null;
  event: string | null;
  params: JsonParams | null;
  booking_id: string | null;
  created_at: string;
}

/** Messages read per page (the newest first; "Mesaje mai vechi" reads the page before). */
export const MESSAGE_PAGE = 50;

const MESSAGE_COLUMNS = 'id, thread_id, kind, sender_id, body, event, params, booking_id, created_at';

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

export async function fetchThreads(side: 'client' | 'shop'): Promise<ThreadsData> {
  const [rows, shopId] = await Promise.all([
    call('list_threads', {} as never),
    side === 'shop' ? call('my_shop_id', {} as never) : Promise.resolve(null),
  ]);
  return { threads: (rows ?? []) as unknown as ThreadSummary[], shopId: (shopId as string | null) ?? null };
}

/** The newest page of a thread, or the page before `before` (a message's `created_at`); oldest first. */
export async function fetchMessages(threadId: string, before?: string): Promise<ChatMessage[]> {
  let query = db().from('messages').select(MESSAGE_COLUMNS).eq('thread_id', threadId);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(MESSAGE_PAGE);
  if (error) throw failure(error);
  return (data as unknown as ChatMessage[]).reverse();
}

/** The conversation of a booking's client and shop (the "Mesaj" button on booking cards). */
export async function bookingThread(bookingId: string): Promise<string> {
  return (await call('booking_thread', { p_booking_id: bookingId })) as string;
}
