import type { Lang } from '../i18n/translate';
import { call } from './rpc';

/**
 * Help Center (A4). Readers get everything they may see in one call (`help_center`), so search runs
 * in the browser; the database decides what each account sees (published only, by account type,
 * company role and the team). The admin's calls (`admin_help_*`) need the second step of sign-in.
 */

export const HELP_AUDIENCES = ['client', 'shop', 'fleet', 'staff'] as const;
export type HelpAudience = (typeof HELP_AUDIENCES)[number];

export const HELP_COMPANY_ROLES = ['admin', 'manager', 'driver', 'accountant'] as const;
export type HelpCompanyRole = (typeof HELP_COMPANY_ROLES)[number];

export const HELP_ICONS = ['book', 'car', 'wrench', 'truck', 'shield', 'card', 'calendar', 'bell', 'users', 'file'] as const;
export type HelpIcon = (typeof HELP_ICONS)[number];

export type HelpKind = 'article' | 'faq';
export type HelpStatus = 'draft' | 'published' | 'archived';

export interface HelpCategory {
  id: string;
  slug: string;
  icon: HelpIcon;
  audience: HelpAudience[];
  position: number;
  name: string;
  description: string | null;
}

export interface HelpArticle {
  id: string;
  slug: string;
  category_id: string;
  kind: HelpKind;
  audience: HelpAudience[];
  featured: boolean;
  position: number;
  title: string;
  summary: string | null;
  body: string;
  keywords: string[];
  updated_at: string;
}

export interface HelpReader {
  staff: boolean;
  types: HelpAudience[];
  company_roles: HelpCompanyRole[];
}

export interface HelpCenterData {
  lang: Lang;
  me: HelpReader;
  categories: HelpCategory[];
  articles: HelpArticle[];
  /** Articles the reader may see that have no text in this language. */
  untranslated: string[];
  /** The reader's own votes, by article id. */
  votes: Record<string, boolean>;
}

// One answer per account and language for the life of the page (another account signing in on the
// same page never sees it); a vote updates it in place.
const cache = new Map<string, Promise<HelpCenterData>>();

export function fetchHelpCenter(account: string, lang: Lang, fresh = false): Promise<HelpCenterData> {
  const key = `${account}:${lang}`;
  let pending = fresh ? undefined : cache.get(key);
  if (!pending) {
    pending = (call('help_center', { p_lang: lang }) as unknown as Promise<HelpCenterData>).catch((e: unknown) => {
      cache.delete(key);
      throw e;
    });
    cache.set(key, pending);
  }
  return pending;
}

/** Forgets the cached Help Center (after the admin changes it, or on sign-out). */
export function forgetHelpCenter(): void {
  cache.clear();
}

export async function sendHelpFeedback(articleId: string, helpful: boolean, requestId: string): Promise<void> {
  await call('help_send_feedback', { p_article: articleId, p_helpful: helpful, p_request_id: requestId });
  for (const pending of cache.values()) {
    void pending.then(
      (data) => {
        data.votes = { ...data.votes, [articleId]: helpful };
      },
      () => {},
    );
  }
}

// ------------------------------------------------------------------------------------ administration

export interface AdminHelpCategory {
  id: string;
  slug: string;
  icon: HelpIcon;
  audience: HelpAudience[];
  position: number;
  active: boolean;
  name_ro: string;
  name_en: string;
  description_ro: string | null;
  description_en: string | null;
  articles: number;
}

export interface AdminHelpArticleRow {
  id: string;
  category_id: string;
  slug: string;
  kind: HelpKind;
  status: HelpStatus;
  audience: HelpAudience[];
  company_roles: HelpCompanyRole[];
  featured: boolean;
  position: number;
  title_ro: string;
  title_en: string | null;
  has_en: boolean;
  version: number;
  updated_at: string;
  helpful: number;
  not_helpful: number;
}

export interface AdminHelpList {
  categories: AdminHelpCategory[];
  articles: AdminHelpArticleRow[];
}

/** What the editor sends and gets back. */
export interface HelpArticleInput {
  category_id: string;
  slug: string;
  kind: HelpKind;
  audience: HelpAudience[];
  company_roles: HelpCompanyRole[];
  featured: boolean;
  title_ro: string;
  summary_ro: string | null;
  body_ro: string;
  keywords_ro: string[];
  title_en: string | null;
  summary_en: string | null;
  body_en: string | null;
  keywords_en: string[];
}

export type HelpRevisionAction = 'seed' | 'create' | 'update' | 'publish' | 'unpublish' | 'archive';

export interface HelpRevision {
  version: number;
  action: HelpRevisionAction;
  changed: string[];
  by: string | null;
  at: string;
  snapshot: HelpArticleInput & { status: HelpStatus };
}

export interface AdminHelpArticle extends HelpArticleInput {
  id: string;
  status: HelpStatus;
  position: number;
  version: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  helpful: number;
  not_helpful: number;
  revisions: HelpRevision[];
}

export interface HelpCategoryInput {
  slug: string;
  icon: HelpIcon;
  audience: HelpAudience[];
  active: boolean;
  name_ro: string;
  name_en: string;
  description_ro: string | null;
  description_en: string | null;
}

export async function fetchAdminHelp(): Promise<AdminHelpList> {
  return (await call('admin_help_list', {} as never)) as unknown as AdminHelpList;
}

export async function fetchAdminHelpArticle(id: string): Promise<AdminHelpArticle> {
  return (await call('admin_help_get_article', { p_id: id })) as unknown as AdminHelpArticle;
}

export async function saveHelpArticle(id: string | null, article: HelpArticleInput, requestId: string): Promise<{ id: string }> {
  const saved = (await call('admin_help_save_article', {
    p_id: id,
    p_article: article as never,
    p_request_id: requestId,
  })) as unknown as { id: string };
  forgetHelpCenter();
  return saved;
}

export async function setHelpArticleStatus(id: string, status: HelpStatus, requestId: string): Promise<void> {
  await call('admin_help_set_article_status', { p_id: id, p_status: status, p_request_id: requestId });
  forgetHelpCenter();
}

export async function deleteHelpArticle(id: string, requestId: string): Promise<void> {
  await call('admin_help_delete_article', { p_id: id, p_request_id: requestId });
  forgetHelpCenter();
}

export async function saveHelpCategory(id: string | null, category: HelpCategoryInput, requestId: string): Promise<void> {
  await call('admin_help_save_category', { p_id: id, p_category: category as never, p_request_id: requestId });
  forgetHelpCenter();
}

export async function deleteHelpCategory(id: string, requestId: string): Promise<void> {
  await call('admin_help_delete_category', { p_id: id, p_request_id: requestId });
  forgetHelpCenter();
}

export async function moveHelpItem(kind: 'category' | 'article', id: string, direction: -1 | 1, requestId: string): Promise<void> {
  await call('admin_help_move', { p_kind: kind, p_id: id, p_direction: direction, p_request_id: requestId });
  forgetHelpCenter();
}
