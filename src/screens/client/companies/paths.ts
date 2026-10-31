/** Cont → Firmele mele (T63b): the companies the client belongs to, and one company. */
export const COMPANIES_PATH = '/c/cont/firme';

export function companyPath(id: string): string {
  return `${COMPANIES_PATH}/${id}`;
}

/** The company's fleet space (T63c), its own frame: `/c/firme/<company>`. */
export function fleetSpacePath(id: string): string {
  return `/c/firme/${id}`;
}
