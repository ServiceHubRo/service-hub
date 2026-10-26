import { NAV, type Role } from '../../app/roles';

/** Cont → Ajutor și contact: `/c/cont/ajutor`, `/s/cont/ajutor` (the admin is the team itself). */
export function helpPath(role: Role): string {
  return `${NAV[role].account.path}/ajutor`;
}

/** Cont → Sugestii (T26): `/c/cont/sugestii`, `/s/cont/sugestii`. */
export function suggestionsPath(role: Role): string {
  return `${NAV[role].account.path}/sugestii`;
}

/** Cont → Notificări (Eduard, 26 Oct: every notification setting in one place): `/c/cont/notificari`, `/s/cont/notificari`. */
export function notificationsPath(role: Role): string {
  return `${NAV[role].account.path}/notificari`;
}
