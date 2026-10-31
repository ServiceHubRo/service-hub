/** Cont → Firmele mele (T63b): the companies the client belongs to, and one company. */
export const COMPANIES_PATH = '/c/cont/firme';

export function companyPath(id: string): string {
  return `${COMPANIES_PATH}/${id}`;
}
