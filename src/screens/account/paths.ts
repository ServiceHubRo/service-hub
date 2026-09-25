import { NAV, type Role } from '../../app/roles';

/** Cont → Ajutor și contact: `/c/cont/ajutor`, `/s/cont/ajutor` (the admin is the team itself). */
export function helpPath(role: Role): string {
  return `${NAV[role].account.path}/ajutor`;
}
