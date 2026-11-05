import { createContext, useContext } from 'react';
import type { MyCompany } from '../../data/companies';

/**
 * Where the client is working (Fleet, T65): the personal space, or one of the companies they belong
 * to. The company comes from the address (`/c/firme/<company>`), so a refresh or a shared link keeps
 * it; the database decides what the member may read there (a changed id answers "not found").
 */
export type ActiveWorkspace = { kind: 'personal' } | { kind: 'company'; id: string };

export interface WorkspaceValue {
  /** The companies the caller is an accepted member of, not archived (`my_companies()`); [] without fleets. */
  companies: MyCompany[];
  /** True once the list has been read (the switcher waits for it: no flash of "no company"). */
  ready: boolean;
  active: ActiveWorkspace;
  /** Opens a space: the same page of the new company when it has it, else its Panou; Caută for Personal. */
  switchTo: (target: ActiveWorkspace) => void;
  /** Reads the list again (after creating, leaving or joining a company). */
  reload: () => Promise<void>;
}

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

/** Inside the client app only; null elsewhere (shops and admins never belong to companies). */
export function useOptionalWorkspace(): WorkspaceValue | null {
  return useContext(WorkspaceContext);
}

/** The company id of a `/c/firme/<id>` address (the fleet space), else null. Never `/c/cont/firme`. */
export function companyOfPath(pathname: string): string | null {
  const m = /^\/c\/firme\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname);
  return m ? m[1]!.toLowerCase() : null;
}
