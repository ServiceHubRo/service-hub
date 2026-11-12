import { call } from './rpc';

/**
 * A6 — the admin's control of the admin accounts (M6) and the security log (M3). Every function is
 * an admin's (aal2, a live session) and checked in the database; the screens only show and ask.
 */

/** One admin, for Platformă → Administratori. Never a deleted account. */
export interface AdminAccount {
  id: string;
  display_id: string;
  name: string | null;
  suspended: boolean;
  /** The admin looking at the list. */
  me: boolean;
  /** The authenticator app is set up (the second step of sign-in). */
  mfa_ready: boolean;
  /** Sessions that still exist (each device signed in). */
  sessions: number;
  last_sign_in_at: string | null;
}

export async function fetchAdmins(): Promise<AdminAccount[]> {
  return (await call('admin_team_admins', {} as never)) as unknown as AdminAccount[];
}

/** Suspends or reactivates another admin (never oneself, never the last active one). A reason is required. */
export async function setAdminSuspended(userId: string, suspended: boolean, reason: string, requestId: string): Promise<void> {
  await call('admin_set_admin_suspended', { p_user_id: userId, p_suspended: suspended, p_reason: reason, p_request_id: requestId } as never);
}

/** Ends every session of another admin: its tokens stop at once; it signs in again with the second step. */
export async function endAdminSessions(userId: string, reason: string, requestId: string): Promise<number> {
  const r = (await call('admin_end_admin_sessions', { p_user_id: userId, p_reason: reason, p_request_id: requestId } as never)) as unknown as {
    sessions_ended: number;
  };
  return r.sessions_ended;
}

/** Ends the admin's own sessions on the other devices; the one in use stays. */
export async function endMyOtherSessions(reason: string, requestId: string): Promise<number> {
  const r = (await call('admin_end_my_other_sessions', { p_reason: reason, p_request_id: requestId } as never)) as unknown as {
    sessions_ended: number;
  };
  return r.sessions_ended;
}

export const SECURITY_SEVERITIES = ['high', 'warning', 'info'] as const;
export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number];

/** The events kept in the database (the others are in the Postgres log only, `sh_security`). */
export const SECURITY_EVENT_KINDS = [
  'admin_denied',
  'admin_session_invalid',
  'access_denied',
  'file_rejected',
  'limit_documents',
  'limit_fleet_uploads',
  'admin_suspended',
  'admin_reactivated',
  'admin_sessions_ended',
  'session_cleanup_failed',
] as const;

/** Repeats of one event within its hour that mark it as unusual activity. */
export const REPEATED_FROM = 5;

/** One event, grouped: the same thing by the same person on the same object within one hour. */
export interface SecurityEvent {
  id: number;
  kind: string;
  severity: SecuritySeverity;
  actor_role: string | null;
  actor_display_id: string | null;
  subject_type: string | null;
  subject_display_id: string | null;
  occurrences: number;
  first_at: string;
  last_at: string;
  detail: Record<string, unknown>;
}

export const SECURITY_PAGE = 50;

/** Newest first; `before` = the last_at of the oldest event already shown. */
export async function fetchSecurityEvents(severity: SecuritySeverity | null, before?: string): Promise<SecurityEvent[]> {
  return (await call('admin_security_events', {
    p_severity: severity,
    p_before: before ?? null,
    p_limit: SECURITY_PAGE,
  } as never)) as unknown as SecurityEvent[];
}
