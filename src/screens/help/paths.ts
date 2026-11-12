import { helpPath } from '../account/paths';
import { SUPPORT_HELP_PATH } from '../support/paths';

/** Who reads the Help Center: clients and shops under Cont → Ajutor și contact, the agent in its own menu. */
export type HelpRole = 'client' | 'shop' | 'support';

/** The Help Center's first page: `/c/cont/ajutor`, `/s/cont/ajutor`, `/suport/ajutor`. */
export function helpHome(role: HelpRole): string {
  return role === 'support' ? SUPPORT_HELP_PATH : helpPath(role);
}

export function helpCategoryPath(role: HelpRole, slug: string): string {
  return `${helpHome(role)}/categorie/${slug}`;
}

export function helpArticlePath(role: HelpRole, slug: string): string {
  return `${helpHome(role)}/articol/${slug}`;
}
