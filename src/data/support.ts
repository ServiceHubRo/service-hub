import { call } from './rpc';
import type { AdminSuggestion, MySuggestion, SuggestionStatus } from './suggestions';

/**
 * The support agent (A2) and the admin's support team. Every answer comes from a support_* or
 * admin_* database function that checks the caller (an agent or an admin after the second step) and
 * writes the audit log; an agent never reads a table of other people directly.
 */

/** An account as an agent sees it: who it is and in what state, never what it did. */
export interface SupportAccount {
  id: string;
  display_id: string;
  role: 'client' | 'shop';
  name: string | null;
  state: 'active' | 'suspended' | 'deleted';
  /** m***@gmail.com */
  email_masked: string | null;
  email_verified: boolean;
  /** The phone's last three digits. */
  phone_last3: string | null;
  lang: 'ro' | 'en';
  created_at: string;
  last_active_at: string | null;
  shop: { name: string; city: string | null; staff_role: 'owner' | 'staff' } | null;
}

export interface SupportAccountDetail extends SupportAccount {
  suggestions: MySuggestion[];
}

/** The shortest search the database accepts. */
export const SUPPORT_SEARCH_MIN = 3;

export async function supportSearchAccounts(q: string): Promise<{ items: SupportAccount[]; more: boolean }> {
  return (await call('support_search_accounts', { p_q: q })) as unknown as { items: SupportAccount[]; more: boolean };
}

export async function supportGetAccount(id: string): Promise<SupportAccountDetail> {
  return (await call('support_get_account', { p_id: id })) as unknown as SupportAccountDetail;
}

export async function supportListSuggestions(): Promise<{ new: number; items: AdminSuggestion[] }> {
  return (await call('support_list_suggestions', {} as never)) as unknown as { new: number; items: AdminSuggestion[] };
}

export async function supportSetSuggestionStatus(id: string, status: SuggestionStatus, requestId: string): Promise<void> {
  await call('support_set_suggestion_status', { p_id: id, p_status: status, p_request_id: requestId });
}

// ------------------------------------------------------------------ Admin → Platformă → Echipa de suport

export interface SupportAgent {
  id: string;
  display_id: string;
  name: string | null;
  email: string | null;
  suspended: boolean;
  /** The agent set up its authenticator app: until then the role gives no access. */
  mfa_ready: boolean;
  granted_at: string | null;
  last_active_at: string | null;
}

export interface FormerAgent {
  id: string;
  display_id: string | null;
  name: string | null;
  revoked_at: string;
  reason: string | null;
  /** The admin who withdrew the role (its ID). */
  by: string | null;
}

export interface SupportTeam {
  agents: SupportAgent[];
  former: FormerAgent[];
}

/** The longest reason the database accepts. */
export const SUPPORT_REASON_MAX = 500;

export async function adminListSupportAgents(): Promise<SupportTeam> {
  return (await call('admin_list_support_agents', {} as never)) as unknown as SupportTeam;
}

/** `account`: the account ID (C-00012) or its email. */
export async function adminGrantSupport(account: string, reason: string, requestId: string): Promise<{ id: string; display_id: string }> {
  return (await call('admin_grant_support', { p_account: account, p_reason: reason, p_request_id: requestId })) as unknown as {
    id: string;
    display_id: string;
  };
}

export async function adminRevokeSupport(userId: string, reason: string, requestId: string): Promise<void> {
  await call('admin_revoke_support', { p_user_id: userId, p_reason: reason, p_request_id: requestId });
}
