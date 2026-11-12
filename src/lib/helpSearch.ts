/**
 * Help Center search (A4): runs in the browser over the articles the reader may see, in the language
 * shown, so results change as the reader types, without asking the server again.
 *
 * - Case and diacritics do not matter: „Rovinietă”, „rovinieta” and „ROVINIETA” are the same; both
 *   Romanian comma letters (ș ț) and the old cedilla ones (ş ţ) fold to s and t.
 * - Each word of the query must appear in the article (title, keywords, summary or text); a word
 *   matches the start of a word in the article, and a longer word (5+ letters) also matches its
 *   inflected forms („programările” finds „programare”, "bookings" finds "booking").
 * - Order: title, then keywords, then summary, then text; an exact phrase in the title first.
 * - When no article has every word, the articles with the most words come instead (`partial`).
 */

export interface SearchableArticle {
  id: string;
  title: string;
  summary: string | null;
  body: string;
  keywords: readonly string[];
}

export interface SearchHit<T extends SearchableArticle> {
  article: T;
  score: number;
  /** A short piece of the text around the first word found, plain text. */
  snippet: string | null;
}

export interface SearchResult<T extends SearchableArticle> {
  hits: SearchHit<T>[];
  /** No article had every word: these have only some of them. */
  partial: boolean;
}

/** Lower case, without diacritics, every other character a space. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  // Romanian
  'si', 'sau', 'de', 'la', 'in', 'din', 'pe', 'cu', 'un', 'o', 'ce', 'cum', 'care', 'pentru', 'ca', 'sa', 'se', 'nu',
  'mai', 'al', 'ale', 'a', 'ai', 'am', 'are', 'este', 'e', 'imi', 'mi', 'meu', 'mea', 'mele', 'mei', 'eu', 'tu',
  // English
  'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'an', 'is', 'are', 'how', 'what', 'my', 'do', 'i', 'can', 'it',
]);

/** The words of a query worth looking for: folded, without short or very common words. */
export function queryWords(query: string): string[] {
  const words = fold(query)
    .split(' ')
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

/** The part of a word that its inflected forms share (Romanian and English endings). */
function stem(word: string): string {
  if (word.length < 5) return word;
  return word.length >= 7 ? word.slice(0, -3) : word.slice(0, -2);
}

/** Whether a folded text contains the word: at the start of one of its words, or an inflected form. */
function has(folded: string, word: string): boolean {
  const padded = ` ${folded}`;
  return padded.includes(` ${word}`) || (word.length >= 5 && padded.includes(` ${stem(word)}`));
}

/** Markdown marks out, so the snippet reads as plain text. */
function plain(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|]/g, '')
    .replace(/^\s*(\d+\.|-)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** About `size` characters of the text around the first query word found, on word boundaries. */
export function snippet(text: string, words: readonly string[], size = 160): string | null {
  const source = plain(text).normalize('NFC');
  // One letter for one letter: a position found in the folded copy is the same in the source.
  const sourceFolded = source.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let at = -1;
  for (const w of words) {
    for (const candidate of [w, stem(w)]) {
      const re = new RegExp(`(^|[^a-z0-9])${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      const m = re.exec(sourceFolded);
      if (m) {
        at = m.index + m[1]!.length;
        break;
      }
    }
    if (at >= 0) break;
  }
  if (at < 0) return null;
  const start = Math.max(0, source.lastIndexOf(' ', Math.max(0, at - 40)) + 1);
  let end = Math.min(source.length, start + size);
  if (end < source.length) {
    const cut = source.lastIndexOf(' ', end);
    if (cut > start) end = cut;
  }
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

interface Folded {
  title: string;
  keywords: string;
  summary: string;
  body: string;
}

const cache = new WeakMap<SearchableArticle, Folded>();
function folded(a: SearchableArticle): Folded {
  let f = cache.get(a);
  if (!f) {
    f = { title: fold(a.title), keywords: fold(a.keywords.join(' ')), summary: fold(a.summary ?? ''), body: fold(plain(a.body)) };
    cache.set(a, f);
  }
  return f;
}

/** Searches the articles; an empty query (or only common words) finds nothing. */
export function searchArticles<T extends SearchableArticle>(articles: readonly T[], query: string, limit = 20): SearchResult<T> {
  const words = queryWords(query);
  if (words.length === 0) return { hits: [], partial: false };
  const phrase = fold(query);

  const scored = articles.map((article) => {
    const f = folded(article);
    let score = 0;
    let found = 0;
    for (const w of words) {
      const inTitle = has(f.title, w);
      const inKeywords = has(f.keywords, w);
      const inSummary = has(f.summary, w);
      const inBody = has(f.body, w);
      if (inTitle || inKeywords || inSummary || inBody) found += 1;
      score += (inTitle ? 10 : 0) + (inKeywords ? 6 : 0) + (inSummary ? 3 : 0) + (inBody ? 1 : 0);
    }
    if (phrase.length > 2 && f.title.includes(phrase)) score += 15;
    return { article, score, found };
  });

  const complete = scored.filter((s) => s.found === words.length);
  const fallback = complete.length === 0 && words.length > 1;
  const pool = fallback ? scored.filter((s) => s.found > 0) : complete;
  const partial = fallback && pool.length > 0;
  pool.sort((a, b) => b.found - a.found || b.score - a.score || a.article.title.localeCompare(b.article.title));

  return {
    partial,
    hits: pool.slice(0, limit).map(({ article, score }) => ({ article, score, snippet: snippet(article.body, words) })),
  };
}
