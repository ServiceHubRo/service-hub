import { call } from './rpc';
import type { StaffRef } from './supportRequests';

/**
 * Retention of support data (A3c2b1). The two jobs start disabled; only an admin (second step) switches
 * one on, with a reason and the exact numbers of the preview it saw. The suggestions past 12 months wait
 * 30 days for a support agent or an admin to check their text. Every answer comes from a database
 * function; none of these tables has a grant.
 */

export const RETENTION_JOBS = ['support_requests', 'suggestions'] as const;
export type RetentionJob = (typeof RETENTION_JOBS)[number];

/** The database's limits (retention_jobs checks, admin_set_retention_job). */
export const RETENTION_REASON_MIN = 10;
export const RETENTION_REASON_MAX = 500;
export const BATCH_SIZES = [10, 50, 100, 250, 500] as const;
export const DEFAULT_BATCH = 50;

/** Kinds the database finds in a suggestion's text (suggestion_text_findings). */
export const FINDING_KINDS = [
  'email',
  'phone',
  'plate',
  'vin',
  'booking_code',
  'account_code',
  'report_code',
  'iban',
  'cnp',
  'card',
  'link',
  'secret',
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];
export type Findings = Partial<Record<FindingKind, number>>;

export interface RetentionCounts {
  eligible: {
    total: number;
    by_status: Record<string, number>;
    messages: number;
    notes: number;
    files: number;
    notifications: number;
  };
  exempt: {
    legal_hold: number;
    legal_hold_request: number;
    legal_hold_account: number;
    author_deleted: number;
  };
  /** When the next request becomes due; null when there is none. */
  next_due_at: string | null;
  /** The suggestions' job only. */
  findings?: Findings;
  without_proposal?: number;
  reviews?: { pending: number; expiring: number; due_7_days: number };
}

export interface RetentionPreview {
  job: RetentionJob;
  now: string;
  enabled: boolean;
  /** Sent back unchanged to switch the job on: the database refuses other numbers. */
  counts: RetentionCounts;
}

export interface RetentionRun {
  started_at: string;
  finished_at: string;
  counts: Record<string, number>;
  failed: number;
  remaining: number;
}

export interface RetentionJobState {
  key: RetentionJob;
  enabled: boolean;
  batch_size: number;
  changed_at: string | null;
  reason: string | null;
  changed_by: StaffRef | null;
  enabled_counts: RetentionCounts | null;
  /** The last ten runs, newest first. */
  runs: RetentionRun[];
}

export async function listRetentionJobs(): Promise<{ now: string; items: RetentionJobState[] }> {
  return (await call('admin_list_retention_jobs', {} as never)) as unknown as { now: string; items: RetentionJobState[] };
}

export async function retentionPreview(job: RetentionJob): Promise<RetentionPreview> {
  return (await call('admin_retention_preview', { p_job: job })) as unknown as RetentionPreview;
}

export async function setRetentionJob(
  p: { job: RetentionJob; enabled: boolean; reason: string; batchSize: number | null; expected: RetentionCounts | null },
  requestId: string,
): Promise<{ enabled: boolean; batch_size: number }> {
  return (await call('admin_set_retention_job', {
    p_job: p.job,
    p_enabled: p.enabled,
    p_reason: p.reason,
    p_batch_size: p.batchSize,
    p_expected: p.expected,
    p_request_id: requestId,
  } as never)) as unknown as { enabled: boolean; batch_size: number };
}

// ------------------------------------------------------------------ the suggestions' review

export type TextReviewState = 'pending' | 'kept';
export type TextReviewAction = 'confirm' | 'edit' | 'remove';

export interface TextReview {
  id: string;
  /** The first day of the month the suggestion was written. */
  created_month: string;
  author_role: 'client' | 'shop' | 'unknown';
  final_status: string;
  text_state: 'pending' | 'confirmed' | 'edited' | 'removed' | 'expired';
  /** The kept text (confirmed or edited). */
  text: string | null;
  /** While pending: the original and the text with what identifies masked (null: nothing proposed). */
  original: string | null;
  proposed: string | null;
  findings: Findings;
  review_due_at: string | null;
}

export async function listTextReviews(state: TextReviewState): Promise<{ now: string; items: TextReview[] }> {
  return (await call('support_list_suggestion_reviews', { p_state: state })) as unknown as { now: string; items: TextReview[] };
}

export async function reviewSuggestionText(
  id: string,
  action: TextReviewAction,
  text: string | null,
  requestId: string,
): Promise<{ state: TextReview['text_state'] }> {
  return (await call('support_review_suggestion_text', {
    p_id: id,
    p_action: action,
    p_text: text,
    p_request_id: requestId,
  } as never)) as unknown as { state: TextReview['text_state'] };
}

/** Whole days left before a review's text is deleted (0 on its last day). */
export function reviewDaysLeft(dueAt: string, now: Date): number {
  return Math.max(0, Math.floor((new Date(dueAt).getTime() - now.getTime()) / 86_400_000));
}

/** A review is urgent in its last 7 days. */
export function reviewUrgent(dueAt: string, now: Date): boolean {
  return new Date(dueAt).getTime() - now.getTime() <= 7 * 86_400_000;
}

/** The findings that are there, in a fixed order. */
export function findingList(f: Findings): { kind: FindingKind; n: number }[] {
  return FINDING_KINDS.filter((k) => (f[k] ?? 0) > 0).map((k) => ({ kind: k, n: f[k] ?? 0 }));
}
