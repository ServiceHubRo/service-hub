import { ADMIN_PROCEDURES_PATH } from '../admin/paths';
import { SUPPORT_PROCEDURES_PATH } from '../support/paths';

/** Who works with the procedures (A5): an agent under /suport, an admin in the Suport zone. */
export type ProcedureMode = 'support' | 'admin';

/** The library: `/suport/proceduri`, `/admin/suport/proceduri`. */
export function proceduresHome(mode: ProcedureMode): string {
  return mode === 'admin' ? ADMIN_PROCEDURES_PATH : SUPPORT_PROCEDURES_PATH;
}

export function procedurePath(mode: ProcedureMode, id: string): string {
  return `${proceduresHome(mode)}/${id}`;
}

/** The editor of a procedure's version in work. */
export function procedureEditPath(mode: ProcedureMode, id: string): string {
  return `${proceduresHome(mode)}/${id}/editare`;
}

/** A new procedure. */
export function newProcedurePath(mode: ProcedureMode): string {
  return `${proceduresHome(mode)}/nou`;
}

/** The categories with their responsibles. */
export function responsiblesPath(mode: ProcedureMode): string {
  return `${proceduresHome(mode)}/responsabili`;
}
