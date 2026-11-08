import type { InboxQuery, RequestStatus, StaffRequestItem } from '../data/supportRequests';

/**
 * The team's request list (A3a): its filters, kept in the address (?responsabil=&stare=&categorie=&vechime=).
 * Since A3c1 the database filters and pages the list (support_inbox); these turn the address into its
 * arguments and say how long an author has been waiting.
 */

/** Everyone, the caller's own, nobody's, the escalated ones, or one member's (their id). */
export type OwnerFilter = 'all' | 'mine' | 'none' | 'escalated' | (string & {});
export type StatusFilter = 'open' | 'all' | RequestStatus;
export type AgeFilter = 'all' | '24' | '48';

export interface RequestFilters {
  owner: OwnerFilter;
  status: StatusFilter;
  category: string;
  age: AgeFilter;
}

export const DEFAULT_FILTERS: RequestFilters = { owner: 'all', status: 'open', category: 'all', age: 'all' };

/** The filters an address asks for; anything unknown falls back to the default. */
export function filtersFrom(params: URLSearchParams): RequestFilters {
  const age = params.get('vechime');
  return {
    owner: params.get('responsabil') || DEFAULT_FILTERS.owner,
    status: (params.get('stare') as StatusFilter | null) || DEFAULT_FILTERS.status,
    category: params.get('categorie') || DEFAULT_FILTERS.category,
    age: age === '24' || age === '48' ? age : 'all',
  };
}

/** The address parameter of a filter, or null for its default (a clean address). */
export const FILTER_PARAMS: Record<keyof RequestFilters, string> = {
  owner: 'responsabil',
  status: 'stare',
  category: 'categorie',
  age: 'vechime',
};

/** Hours the author has been waiting for an answer, or null when nobody waits. */
export function waitingHours(item: Pick<StaffRequestItem, 'waiting_since'>, now: Date): number | null {
  if (!item.waiting_since) return null;
  const since = new Date(item.waiting_since).getTime();
  return Number.isFinite(since) ? Math.max(0, (now.getTime() - since) / 3_600_000) : null;
}

/** The filters as support_inbox takes them. */
export function inboxArgs(f: RequestFilters): InboxQuery {
  return { owner: f.owner, status: f.status, category: f.category, age: f.age === 'all' ? null : (Number(f.age) as 24 | 48) };
}

/** The address of the list with only this filter set (the others at their default). */
export function filterSearch(key: keyof RequestFilters, value: string): string {
  return value === DEFAULT_FILTERS[key] ? '' : `?${FILTER_PARAMS[key]}=${encodeURIComponent(value)}`;
}

/** The warning a wait deserves: none, over 24 hours, over 48 hours (calendar hours). */
export function waitingLevel(hours: number | null): 'none' | 'late' | 'urgent' {
  if (hours === null) return 'none';
  return hours >= 48 ? 'urgent' : hours >= 24 ? 'late' : 'none';
}

/** A wait as words: under an hour, whole hours up to 48, then whole days. */
export function waitingSpan(hours: number): { unit: 'lessThanHour' | 'hours' | 'days'; n: number } {
  if (hours < 1) return { unit: 'lessThanHour', n: 0 };
  if (hours < 48) return { unit: 'hours', n: Math.floor(hours) };
  return { unit: 'days', n: Math.floor(hours / 24) };
}
