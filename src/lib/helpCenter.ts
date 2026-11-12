import type { HelpArticle, HelpAudience, HelpCategory, HelpReader } from '../data/help';

/**
 * Help Center logic without the screen (A4): what a reader sees first, and the same content rules as
 * the database (help_text_ok), so the editor names a problem before saving.
 */

/** How close something is to the reader: 2 = written for one of its audiences, 1 = for everyone, 0 = other. */
export function relevance(audience: readonly HelpAudience[], reader: Pick<HelpReader, 'types' | 'staff'>): number {
  if (reader.staff) return audience.includes('staff') ? 2 : 1;
  if (audience.length === 0) return 1;
  return audience.some((a) => reader.types.includes(a)) ? 2 : 0;
}

/** Categories for the reader's own account first (a company member: its fleet category right after the
 * driver one), then the general ones, each group in the admin's order. */
export function orderCategories(categories: readonly HelpCategory[], reader: HelpReader): HelpCategory[] {
  return [...categories].sort((a, b) => relevance(b.audience, reader) - relevance(a.audience, reader) || a.position - b.position);
}

/** The articles marked as recommended, the reader's own first; at most `limit`. */
export function featuredArticles(articles: readonly HelpArticle[], reader: HelpReader, categories: readonly HelpCategory[], limit = 6): HelpArticle[] {
  const order = new Map(orderCategories(categories, reader).map((c, i) => [c.id, i]));
  return articles
    .filter((a) => a.kind === 'article' && a.featured)
    .sort(
      (a, b) =>
        relevance(b.audience, reader) - relevance(a.audience, reader) ||
        (order.get(a.category_id) ?? 99) - (order.get(b.category_id) ?? 99) ||
        a.position - b.position,
    )
    .slice(0, limit);
}

/** The frequent questions: recommended ones first, the reader's own first; at most `limit`. */
export function frequentQuestions(articles: readonly HelpArticle[], reader: HelpReader, limit = 8): HelpArticle[] {
  return articles
    .filter((a) => a.kind === 'faq')
    .sort(
      (a, b) =>
        Number(b.featured) - Number(a.featured) ||
        relevance(b.audience, reader) - relevance(a.audience, reader) ||
        a.position - b.position,
    )
    .slice(0, limit);
}

/** A category's articles (pages first, then its questions), in the admin's order. */
export function articlesOf(articles: readonly HelpArticle[], categoryId: string): { pages: HelpArticle[]; questions: HelpArticle[] } {
  const own = articles.filter((a) => a.category_id === categoryId).sort((a, b) => a.position - b.position);
  return { pages: own.filter((a) => a.kind === 'article'), questions: own.filter((a) => a.kind === 'faq') };
}

/** Other articles of the same category, for the end of an article. */
export function relatedArticles(articles: readonly HelpArticle[], article: HelpArticle, limit = 3): HelpArticle[] {
  return articles.filter((a) => a.category_id === article.category_id && a.id !== article.id && a.kind === 'article').slice(0, limit);
}

// ------------------------------------------------------------------------------------ editing

export const HELP_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const HELP_LIMITS = {
  title: [3, 140],
  summary: [3, 300],
  body: [10, 20000],
  keyword: [2, 40],
  keywords: 20,
  name: [2, 80],
  description: [2, 200],
} as const;

/** A slug from a title: „Ștergerea contului” → stergerea-contului. */
export function slugify(text: string, max = 80): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

export type HelpTextProblem = 'length' | 'html' | 'script' | 'placeholder' | 'link' | 'control';

/** The first reason the database would refuse a text, or null (same rules as help_text_ok). */
export function helpTextProblem(text: string, [min, max]: readonly [number, number]): HelpTextProblem | null {
  const trimmed = text.trim();
  if (trimmed.length < min || trimmed.length > max) return 'length';
  // eslint-disable-next-line no-control-regex
  if (/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text)) return 'control';
  if (/<\s*(!|[/?]?\s*[a-z])/i.test(text)) return 'html';
  if (/(javascript|vbscript)\s*:/i.test(text) || /\bdata:[a-z-]+\//i.test(text)) return 'script';
  if (text.includes('{{')) return 'placeholder';
  if (/\]\(\s*(?!https:\/\/|mailto:)/i.test(text)) return 'link';
  return null;
}

/** Keywords from a comma-separated line: trimmed, lower case, without repeats. */
export function parseKeywords(line: string): string[] {
  return [
    ...new Set(
      line
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k !== ''),
    ),
  ];
}

export function keywordsProblem(keywords: readonly string[]): 'count' | 'keyword' | null {
  if (keywords.length > HELP_LIMITS.keywords) return 'count';
  return keywords.some((k) => helpTextProblem(k, HELP_LIMITS.keyword) !== null) ? 'keyword' : null;
}
