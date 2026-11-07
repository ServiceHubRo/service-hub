import { isOpen, type RequestStatus, type StaffRequestItem } from '../data/supportRequests';

/**
 * The team's request list (A3a): its filters, kept in the address (?responsabil=&stare=&categorie=&vechime=).
 * Pure, so the list can be filtered on the device without asking the database again.
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

export function filterRequests(items: StaffRequestItem[], f: RequestFilters, me: string, now: Date): StaffRequestItem[] {
  return items.filter((r) => {
    switch (f.owner) {
      case 'all':
        break;
      case 'mine':
        if (r.assigned?.id !== me) return false;
        break;
      case 'none':
        if (r.assigned || r.escalated) return false;
        break;
      case 'escalated':
        if (!r.escalated) return false;
        break;
      default:
        if (r.assigned?.id !== f.owner) return false;
    }
    if (f.status === 'open' ? !isOpen(r.status) : f.status !== 'all' && r.status !== f.status) return false;
    if (f.category !== 'all' && r.category !== f.category) return false;
    if (f.age !== 'all') {
      const hours = waitingHours(r, now);
      if (hours === null || hours < Number(f.age)) return false;
    }
    return true;
  });
}
