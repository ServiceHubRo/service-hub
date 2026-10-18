import { call, failure, RpcError } from './rpc';
import { supabase } from './supabase';

/**
 * Sugestii (T26): ideas written by clients and shops from Cont, read by the admin. Written only
 * through submit_suggestion / admin_set_suggestion_status; the author reads their own rows.
 */

export const SUGGESTION_STATUSES = ['new', 'planned', 'done', 'declined'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** The longest suggestion the database accepts. */
export const SUGGESTION_MAX = 1000;

export interface MySuggestion {
  id: string;
  body: string;
  status: SuggestionStatus;
  created_at: string;
}

export interface AdminSuggestion extends MySuggestion {
  role: 'client' | 'shop';
  updated_at: string;
  author_id: string;
  display_id: string;
  author_name: string | null;
  shop_id: string | null;
  shop_name: string | null;
}

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

/** The signed-in account's suggestions, newest first. */
export async function fetchMySuggestions(): Promise<MySuggestion[]> {
  const { data, error } = await db()
    .from('suggestions')
    .select('id, body, status, created_at')
    .order('created_at', { ascending: false });
  if (error) throw failure(error);
  return (data ?? []) as MySuggestion[];
}

export async function submitSuggestion(body: string, requestId: string): Promise<MySuggestion> {
  const res = (await call('submit_suggestion', { p_body: body, p_request_id: requestId })) as unknown as {
    id: string;
    status: SuggestionStatus;
    created_at: string;
  };
  return { id: res.id, body: body.trim(), status: res.status, created_at: res.created_at };
}

export async function adminListSuggestions(): Promise<{ new: number; items: AdminSuggestion[] }> {
  return (await call('admin_list_suggestions', {} as never)) as unknown as { new: number; items: AdminSuggestion[] };
}

export async function adminSetSuggestionStatus(id: string, status: SuggestionStatus, requestId: string): Promise<void> {
  await call('admin_set_suggestion_status', { p_id: id, p_status: status, p_request_id: requestId });
}
