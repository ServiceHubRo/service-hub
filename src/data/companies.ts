import type { Database } from './database.types';
import { call, failure, RpcError } from './rpc';
import { newInviteToken } from './shop';
import { supabase } from './supabase';
import { webOrigin } from '../lib/native';
import type { FleetRole } from '../lib/fleet';

/**
 * Companies and their members (T63b, docs/FLEET_PLAN.md §3.1). A company is a space inside client
 * accounts; every write is a database function that checks the caller's role in that company and
 * logs the change (`company_audit_log`). The browser reads the company row and its own member row
 * through RLS; the team with names comes from `list_company_members`. Optional details travel as
 * null (the functions have no defaults, so every argument is sent).
 */

export type Company = Database['public']['Tables']['companies']['Row'];

export interface MyCompany {
  id: string;
  name: string;
  role: FleetRole;
}

export interface CompanyMember {
  id: string;
  role: FleetRole;
  name: string | null;
  email: string;
  invited_at: string;
  accepted_at: string | null;
  expired: boolean;
  is_me: boolean;
  /** The rights the admin gave beyond the role (T63i) and the member's own approval limit. */
  extra_caps: string[];
  approval_limit: number | null;
}

export interface CompanyInvite {
  company_name: string;
  email: string;
  role: FleetRole;
}

export interface CompanyDetails {
  name: string;
  vatId: string | null;
  regCom: string | null;
  address: string | null;
}

function db() {
  if (!supabase) throw new RpcError('network');
  return supabase;
}

/** Whether companies are switched on (`platform_settings.fleet_enabled`). */
export async function fetchFleetEnabled(): Promise<boolean> {
  const { data, error } = await db().from('platform_settings').select('fleet_enabled').eq('id', 1).maybeSingle();
  if (error) throw failure(error);
  return data?.fleet_enabled ?? false;
}

export async function fetchMyCompanies(): Promise<MyCompany[]> {
  return (await call('my_companies', {} as never)) as unknown as MyCompany[];
}

/** One company the caller belongs to (RLS), or null. */
export async function fetchCompany(id: string): Promise<Company | null> {
  const { data, error } = await db().from('companies').select('*').eq('id', id).maybeSingle();
  if (error) throw failure(error);
  return data;
}

export async function createCompany(d: CompanyDetails, requestId: string): Promise<Company> {
  return (await call('create_company', {
    p_name: d.name,
    p_vat_id: d.vatId ?? null,
    p_reg_com: d.regCom ?? null,
    p_address: d.address ?? null,
    p_request_id: requestId,
  } as never)) as unknown as Company;
}

export async function updateCompany(id: string, d: CompanyDetails, requestId: string): Promise<Company> {
  return (await call('update_company', {
    p_company: id,
    p_name: d.name,
    p_vat_id: d.vatId ?? null,
    p_reg_com: d.regCom ?? null,
    p_address: d.address ?? null,
    p_request_id: requestId,
  } as never)) as unknown as Company;
}

export async function setCompanyRules(
  id: string,
  rules: { approvalLimit: number | null; budgetMonthly: number | null; budgetYearly: number | null },
  requestId: string,
): Promise<Company> {
  return (await call('set_company_rules', {
    p_company: id,
    p_manager_approval_limit: rules.approvalLimit ?? null,
    p_budget_monthly: rules.budgetMonthly ?? null,
    p_budget_yearly: rules.budgetYearly ?? null,
    p_request_id: requestId,
  } as never)) as unknown as Company;
}

export async function listCompanyMembers(id: string): Promise<CompanyMember[]> {
  return (await call('list_company_members', { p_company: id })) as unknown as CompanyMember[];
}

export { newInviteToken };

/** The link the invited person opens: inside the client app, so signing in brings them back here. */
export function companyInviteLink(token: string): string {
  return `${webOrigin()}${companyInvitePath(token)}`;
}

export function companyInvitePath(token: string): string {
  return `/c/firme/invitatie/${token}`;
}

export async function inviteCompanyMember(company: string, email: string, role: FleetRole, token: string, requestId: string): Promise<void> {
  await call('invite_company_member', { p_company: company, p_email: email, p_role: role, p_token: token, p_request_id: requestId });
}

/** The invitation behind a link, or null when it is unknown, used or expired. */
export async function getCompanyInvite(token: string): Promise<CompanyInvite | null> {
  return (await call('get_company_invite', { p_token: token })) as unknown as CompanyInvite | null;
}

export async function acceptCompanyInvite(token: string, requestId: string): Promise<Company> {
  return (await call('accept_company_invite', { p_token: token, p_request_id: requestId })) as unknown as Company;
}

export async function setCompanyMemberRole(member: string, role: FleetRole, requestId: string): Promise<void> {
  await call('set_company_member_role', { p_member: member, p_role: role, p_request_id: requestId });
}

/** The admin gives one member rights beyond their role and, with the right to approve, their own limit. */
export async function setCompanyMemberRights(member: string, caps: string[], approvalLimit: number | null, requestId: string): Promise<void> {
  await call('set_company_member_rights', { p_member: member, p_caps: caps, p_approval_limit: approvalLimit, p_request_id: requestId } as never);
}

/** Removes a member or a pending invitation; on one's own row it means leaving the company. */
export async function removeCompanyMember(member: string, requestId: string): Promise<void> {
  await call('remove_company_member', { p_member: member, p_request_id: requestId });
}

export async function transferCompanyAdmin(member: string, requestId: string): Promise<void> {
  await call('transfer_company_admin', { p_member: member, p_request_id: requestId });
}
