import { NAV, type Role } from '../../app/roles';

/** Cont → Ajutor și contact: `/c/cont/ajutor`, `/s/cont/ajutor` (the admin is the team itself). */
export function helpPath(role: Role): string {
  return `${NAV[role].account.path}/ajutor`;
}

/** Cont → Ajutor și contact → Solicitările mele (A3a): `/c/cont/ajutor/solicitari`. */
export function requestsPath(role: Role): string {
  return `${helpPath(role)}/solicitari`;
}

/** A new request; `?categorie=` picks the category. */
export function newRequestPath(role: Role): string {
  return `${requestsPath(role)}/noua`;
}

export function requestPath(role: Role, id: string): string {
  return `${requestsPath(role)}/${id}`;
}

/** Cont → Sugestii (T26): `/c/cont/sugestii`, `/s/cont/sugestii`. */
export function suggestionsPath(role: Role): string {
  return `${NAV[role].account.path}/sugestii`;
}

/** Cont → Notificări (Eduard, 26 Oct: every notification setting in one place): `/c/cont/notificari`, `/s/cont/notificari`. */
export function notificationsPath(role: Role): string {
  return `${NAV[role].account.path}/notificari`;
}

/** Cont → Date pentru deviz (T50), the client's company printed on quotes: `/c/cont/firma`. */
export const COMPANY_PATH = '/c/cont/firma';
