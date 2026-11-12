import type { Json } from './database.types';
import { call } from './rpc';

/**
 * Internal procedures (A5): the team's operating manual. Only agents and admins reach these calls (the
 * database checks the caller at every one: `require_staff`, `require_admin`); the library comes in one
 * call with the published texts, so search and filters run in the browser.
 */

export const PROCEDURE_CATEGORIES = [
  'access',
  'accounts',
  'bookings',
  'complaints',
  'billing',
  'technical',
  'notifications',
  'personal_data',
  'security',
  'fraud',
  'escalation',
] as const;
export type ProcedureCategory = (typeof PROCEDURE_CATEGORIES)[number];

export type ProcedureKind = 'usual' | 'exceptional';
export type ProcedureVisibility = 'support' | 'admin';
export type ProcedureStatus = 'draft' | 'published' | 'archived';
export type VersionStatus = 'draft' | 'pending' | 'approved';

/** One language's text: the database refuses anything else (procedure_content_issue). */
export interface ProcedureContent {
  title: string;
  applies_when: string;
  purpose: string;
  responsibilities?: string;
  steps: string[];
  deadlines?: string;
  escalation: string;
  forbidden?: string;
  warnings?: string;
}

export interface ProcedureVersion {
  id: string;
  version: number;
  status: VersionStatus;
  author: string | null;
  author_id: string | null;
  seeded: boolean;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  published_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  title_ro: string;
  title_en: string | null;
  content_ro?: ProcedureContent;
  content_en?: ProcedureContent | null;
}

export interface TeamRef {
  id: string;
  display_id: string;
  name: string | null;
  role: 'support' | 'admin' | string;
}

export interface Responsible {
  user: TeamRef | null;
  display_id: string;
  assigned_at: string;
  assigned_by: string | null;
  /** The account is gone, suspended or no longer in the team: the admin names someone again. */
  needs_reassignment: boolean;
}

export interface Procedure {
  id: string;
  category: ProcedureCategory;
  kind: ProcedureKind;
  visibility: ProcedureVisibility;
  critical: boolean;
  support_categories: string[];
  status: ProcedureStatus;
  created_at: string;
  updated_at: string;
  responsible: Responsible | null;
  /** The version readers see, with its text (null while never published, or not readable by the caller). */
  published: ProcedureVersion | null;
  /** The version in work, when the caller may edit it. */
  open: ProcedureVersion | null;
  can_edit: boolean;
  ack_required: boolean;
  acknowledged_at: string | null;
  /** Admin: how many of the people who must confirm the version shown did. */
  acks?: { done: number; total: number };
}

export interface ProcedureDetail extends Procedure {
  versions: ProcedureVersion[];
}

export interface SupportCategoryRef {
  key: string;
  name_ro: string;
  name_en: string;
}

export interface ProcedureLibrary {
  me: { id: string; role: 'support' | 'admin'; display_id: string };
  categories: { key: ProcedureCategory; responsible: Responsible | null }[];
  procedures: Procedure[];
  support_categories: SupportCategoryRef[];
  /** Admin only: the active agents and admins a category can be given to. */
  team: TeamRef[] | null;
}

export interface ProcedureSettings {
  category: ProcedureCategory;
  kind: ProcedureKind;
  support_categories: string[];
  /** Admin only (an agent's procedure is for agents and not critical). */
  visibility?: ProcedureVisibility;
  critical?: boolean;
}

export interface AckPerson extends TeamRef {
  acknowledged_at: string | null;
}

export interface ProcedureAcks {
  id: string;
  critical: boolean;
  version: number | null;
  version_id: string | null;
  published_at: string | null;
  people: AckPerson[];
}

export async function fetchProcedures(): Promise<ProcedureLibrary> {
  return (await call('staff_procedures', {} as never)) as unknown as ProcedureLibrary;
}

export async function fetchProcedure(id: string): Promise<ProcedureDetail> {
  return (await call('staff_procedure_get', { p_id: id })) as unknown as ProcedureDetail;
}

export async function fetchRequestProcedures(requestId: string): Promise<Procedure[]> {
  return (await call('support_procedures_for_request', { p_request: requestId })) as unknown as Procedure[];
}

export async function createProcedure(
  settings: ProcedureSettings,
  ro: ProcedureContent,
  en: ProcedureContent | null,
  requestId: string,
): Promise<{ id: string; version_id: string }> {
  return (await call('staff_procedure_create', {
    p_procedure: settings as unknown as Json,
    p_content_ro: ro as unknown as Json,
    p_content_en: en as unknown as Json,
    p_request_id: requestId,
  })) as unknown as { id: string; version_id: string };
}

/** Saves a draft; `settings` only while the procedure was never published (null keeps them). */
export async function saveProcedureDraft(
  versionId: string,
  ro: ProcedureContent,
  en: ProcedureContent | null,
  settings: ProcedureSettings | null,
  requestId: string,
): Promise<void> {
  await call('staff_procedure_save', {
    p_version_id: versionId,
    p_content_ro: ro as unknown as Json,
    p_content_en: en as unknown as Json,
    p_procedure: settings as unknown as Json,
    p_request_id: requestId,
  });
}

export async function newProcedureVersion(procedureId: string, requestId: string): Promise<{ version_id: string }> {
  return (await call('staff_procedure_new_version', { p_procedure_id: procedureId, p_request_id: requestId })) as unknown as {
    version_id: string;
  };
}

export type ProcedureStep = 'submit' | 'to_draft' | 'discard';

export async function moveProcedureVersion(
  versionId: string,
  step: ProcedureStep,
  requestId: string,
): Promise<{ procedure_deleted?: boolean }> {
  return (await call('staff_procedure_step', { p_version_id: versionId, p_step: step, p_request_id: requestId })) as unknown as {
    procedure_deleted?: boolean;
  };
}

/** „Am citit”: only this explicit call writes the confirmation. */
export async function acknowledgeProcedure(versionId: string, requestId: string): Promise<{ acknowledged_at: string }> {
  return (await call('staff_procedure_acknowledge', { p_version_id: versionId, p_request_id: requestId })) as unknown as {
    acknowledged_at: string;
  };
}

export async function approveProcedure(versionId: string, publish: boolean, requestId: string): Promise<void> {
  await call('admin_procedure_approve', { p_version_id: versionId, p_publish: publish, p_request_id: requestId });
}

export async function publishProcedure(versionId: string, requestId: string): Promise<void> {
  await call('admin_procedure_publish', { p_version_id: versionId, p_request_id: requestId });
}

export async function setProcedureSettings(id: string, settings: ProcedureSettings, requestId: string): Promise<void> {
  await call('admin_procedure_set_settings', { p_id: id, p_procedure: settings as unknown as Json, p_request_id: requestId });
}

export async function archiveProcedure(id: string, archived: boolean, requestId: string): Promise<void> {
  await call('admin_procedure_archive', { p_id: id, p_archived: archived, p_request_id: requestId });
}

export async function fetchProcedureAcks(id: string): Promise<ProcedureAcks> {
  return (await call('admin_procedure_acknowledgements', { p_id: id })) as unknown as ProcedureAcks;
}

export async function setCategoryResponsible(category: ProcedureCategory, userId: string | null, requestId: string): Promise<void> {
  await call('admin_procedure_set_responsible', { p_category: category, p_user: userId, p_request_id: requestId });
}
