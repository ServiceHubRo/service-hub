import type { Procedure, ProcedureCategory, ProcedureContent, ProcedureKind } from '../data/procedures';
import type { Lang } from '../i18n/translate';
import { helpTextProblem, type HelpTextProblem } from './helpCenter';
import { searchArticles, type SearchableArticle, type SearchHit } from './helpSearch';

/**
 * Internal procedures (A5): the same content rules as the database (procedure_content_issue, with
 * help_text_ok and text_has_secret), the language a procedure is read in, the library's filters and
 * search (the Help Center's search, A4, over the procedures' texts).
 */

export const PROCEDURE_FIELDS = [
  'title',
  'applies_when',
  'purpose',
  'responsibilities',
  'steps',
  'deadlines',
  'escalation',
  'forbidden',
  'warnings',
] as const;
export type ProcedureField = (typeof PROCEDURE_FIELDS)[number];

type TextField = Exclude<ProcedureField, 'steps'>;

/** [min, max] characters, and whether the field is required. */
export const PROCEDURE_LIMITS: Record<TextField, { range: readonly [number, number]; required: boolean }> = {
  title: { range: [3, 140], required: true },
  applies_when: { range: [10, 2000], required: true },
  purpose: { range: [10, 2000], required: true },
  responsibilities: { range: [3, 2000], required: false },
  deadlines: { range: [3, 2000], required: false },
  escalation: { range: [10, 2000], required: true },
  forbidden: { range: [3, 2000], required: false },
  warnings: { range: [3, 2000], required: false },
};
export const STEP_LIMIT: readonly [number, number] = [3, 1000];
export const MAX_STEPS = 30;

export type ContentProblem = HelpTextProblem | 'required' | 'steps' | 'secret';

/**
 * Text that looks like a password, a key, a token or a card number (the database's text_has_secret,
 * its main patterns): refused before saving, so the field says why.
 */
export function looksSecret(text: string): boolean {
  if (
    /\b(sk|rk)_(live|test)_[0-9a-z]{8,}/i.test(text) ||
    /whsec_[0-9A-Za-z]{8,}/.test(text) ||
    /sb_secret_[0-9A-Za-z_-]{8,}/.test(text) ||
    /\bgh[pousr]_[0-9A-Za-z]{20,}/.test(text) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(text) ||
    /eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}/.test(text) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(text) ||
    /(^|[^\p{L}\p{N}_])(parol[aăe]|password|passwd|pwd|pin|token|secret|cheie|api[ _-]?key|cod de acces)\s*[:=]\s*\S{4,}/iu.test(text)
  ) {
    return true;
  }
  const withoutIds = text.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, ' ');
  for (const m of withoutIds.matchAll(/[A-Za-z0-9_+/=-]{32,}/g)) {
    if (/[A-Za-z]/.test(m[0]) && /[0-9]/.test(m[0])) return true;
  }
  for (const m of text.matchAll(/\d(?:[ -]?\d){12,18}/g)) {
    const digits = m[0].replace(/\D/g, '');
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let x = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        x *= 2;
        if (x > 9) x -= 9;
      }
      sum += x;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

/** Steps from the editor's text: one per line, list marks („1.”, „-”) removed, empty lines left out. */
export function parseSteps(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(\d+[.)]|[-*•])\s+/, '').trim())
    .filter((line) => line !== '');
}

/** The editor's text for a list of steps. */
export function stepsText(steps: readonly string[]): string {
  return steps.join('\n');
}

/** The first problem of each field (null when it is fine), as the database would refuse it. */
export function contentProblems(content: Partial<ProcedureContent>): Partial<Record<ProcedureField, ContentProblem>> {
  const out: Partial<Record<ProcedureField, ContentProblem>> = {};
  for (const [field, { range, required }] of Object.entries(PROCEDURE_LIMITS) as [TextField, (typeof PROCEDURE_LIMITS)[TextField]][]) {
    const value = (content[field] ?? '').trim();
    if (value === '') {
      if (required) out[field] = 'required';
      continue;
    }
    const problem = helpTextProblem(value, range);
    if (problem) out[field] = problem;
    else if (looksSecret(value)) out[field] = 'secret';
  }
  const steps = content.steps ?? [];
  if (steps.length === 0) out.steps = 'required';
  else if (steps.length > MAX_STEPS || steps.some((s) => helpTextProblem(s, STEP_LIMIT) !== null)) out.steps = 'steps';
  else if (steps.some(looksSecret)) out.steps = 'secret';
  return out;
}

/** The content as sent: trimmed, optional fields left out when empty. */
export function cleanContent(content: Partial<ProcedureContent>): ProcedureContent {
  const text = (v: string | undefined) => (v ?? '').trim();
  const out: ProcedureContent = {
    title: text(content.title),
    applies_when: text(content.applies_when),
    purpose: text(content.purpose),
    steps: (content.steps ?? []).map((s) => s.trim()).filter((s) => s !== ''),
    escalation: text(content.escalation),
  };
  for (const field of ['responsibilities', 'deadlines', 'forbidden', 'warnings'] as const) {
    const v = text(content[field]);
    if (v) out[field] = v;
  }
  return out;
}

/** Whether a language's content has anything written in it (English is all or nothing). */
export function hasContent(content: Partial<ProcedureContent> | null | undefined): boolean {
  if (!content) return false;
  return PROCEDURE_FIELDS.some((f) => (f === 'steps' ? (content.steps ?? []).some((s) => s.trim() !== '') : (content[f] ?? '').trim() !== ''));
}

/** The text to show in the app's language: English when it exists, otherwise Romanian (flagged). */
export function contentIn(
  lang: Lang,
  version: { content_ro?: ProcedureContent; content_en?: ProcedureContent | null } | null | undefined,
): { content: ProcedureContent | null; fallback: boolean } {
  if (!version?.content_ro) return { content: null, fallback: false };
  if (lang === 'en') return version.content_en ? { content: version.content_en, fallback: false } : { content: version.content_ro, fallback: true };
  return { content: version.content_ro, fallback: false };
}

/** A procedure's title in the app's language (the published one, else the version in work). */
export function procedureTitle(lang: Lang, p: Pick<Procedure, 'published' | 'open'>): string {
  const v = p.published ?? p.open;
  if (!v) return '';
  return (lang === 'en' && v.title_en) || v.title_ro;
}

// ------------------------------------------------------------------------------------ library

export interface LibraryFilters {
  category: ProcedureCategory | '';
  kind: ProcedureKind | '';
  /** A team member's id, or 'none' for categories without one. */
  responsible: string;
  critical: boolean;
  /** Admin: the procedures that wait for an approval; agent: its own drafts. */
  inWork: boolean;
}

export const NO_FILTERS: LibraryFilters = { category: '', kind: '', responsible: '', critical: false, inWork: false };

export function filterProcedures(procedures: readonly Procedure[], f: LibraryFilters): Procedure[] {
  return procedures.filter(
    (p) =>
      (f.category === '' || p.category === f.category) &&
      (f.kind === '' || p.kind === f.kind) &&
      (f.responsible === '' ||
        (f.responsible === 'none' ? !p.responsible?.user || p.responsible.needs_reassignment : p.responsible?.user?.id === f.responsible)) &&
      (!f.critical || p.critical) &&
      (!f.inWork || p.open !== null),
  );
}

/** Critical procedures the reader has not confirmed in their version shown. */
export function toConfirm(procedures: readonly Procedure[]): Procedure[] {
  return procedures.filter((p) => p.ack_required && p.published && !p.acknowledged_at);
}

/** The latest published, newest first. */
export function recentProcedures(procedures: readonly Procedure[], limit = 5): Procedure[] {
  return procedures
    .filter((p) => p.published?.published_at)
    .sort((a, b) => (b.published!.published_at! < a.published!.published_at! ? -1 : 1))
    .slice(0, limit);
}

export interface SearchableProcedure extends SearchableArticle {
  procedure: Procedure;
}

/** Search over the published texts (and the titles of drafts the reader writes), in the app's language. */
export function searchProcedures(procedures: readonly Procedure[], lang: Lang, query: string): SearchHit<SearchableProcedure>[] {
  const items: SearchableProcedure[] = procedures.map((p) => {
    const { content } = contentIn(lang, p.published ?? p.open);
    const body = content
      ? [content.applies_when, content.purpose, content.responsibilities, ...content.steps, content.deadlines, content.escalation, content.forbidden, content.warnings]
          .filter(Boolean)
          .join('\n\n')
      : '';
    return { id: p.id, title: procedureTitle(lang, p), summary: content?.applies_when ?? null, body, keywords: [], procedure: p };
  });
  return searchArticles(items, query, 30).hits;
}
