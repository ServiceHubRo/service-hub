import { describe, expect, it } from 'vitest';
import type { HelpArticle, HelpCategory, HelpReader } from '../../src/data/help';
import { FORBIDDEN_EN, FORBIDDEN_RO } from '../../src/i18n/glossary';
import {
  articlesOf,
  featuredArticles,
  frequentQuestions,
  helpTextProblem,
  keywordsProblem,
  orderCategories,
  parseKeywords,
  relevance,
  slugify,
} from '../../src/lib/helpCenter';
import { fold, queryWords, searchArticles, snippet } from '../../src/lib/helpSearch';
import { myDataSheets } from '../../src/lib/myData';

// A4 — Help Center: search (case, diacritics, Romanian forms, no result), what each reader sees first,
// the same content rules as the database, and the first content against the editorial standard.

const article = (p: Partial<HelpArticle> & Pick<HelpArticle, 'id' | 'title'>): HelpArticle => ({
  slug: p.id,
  category_id: 'c1',
  kind: 'article',
  audience: [],
  featured: false,
  position: 1,
  summary: null,
  body: 'Text.',
  keywords: [],
  updated_at: '2026-11-12T06:00:00Z',
  ...p,
});

const ARTICLES: HelpArticle[] = [
  article({ id: 'itp', title: 'ITP, RCA, rovinietă și revizii', body: 'Cu 30 de zile înainte de expirarea unui document apare un aviz.', keywords: ['itp', 'rca', 'rovinieta'], audience: ['client'] }),
  article({ id: 'booking', title: 'Programări', body: 'O programare se face în patru pași. Anulează programarea din Programări.', audience: ['client'] }),
  article({ id: 'password', title: 'Recuperarea parolei', body: 'Pe Autentificare, apasă Ai uitat parola?. Scrie adresa contului.', keywords: ['parola uitata'] }),
  article({ id: 'quote', title: 'Devize și aprobări', body: 'Devizul are manoperă și piese.', audience: ['shop'] }),
];

describe('Help Center search', () => {
  it('ignores case and diacritics, both Romanian comma and cedilla letters', () => {
    expect(fold('ROVINIETĂ Șofer ţară')).toBe('rovinieta sofer tara');
    expect(fold('şofer')).toBe('sofer');
    for (const q of ['rovinieta', 'ROVINIETĂ', 'Rovinietă']) expect(searchArticles(ARTICLES, q).hits[0]?.article.id).toBe('itp');
  });

  it('finds Romanian forms of a word and ranks the title first', () => {
    expect(searchArticles(ARTICLES, 'programările').hits[0]?.article.id).toBe('booking');
    expect(searchArticles(ARTICLES, 'programare').hits[0]?.article.id).toBe('booking');
    expect(searchArticles(ARTICLES, 'parola uitată').hits[0]?.article.id).toBe('password');
  });

  it('searches the text and the keywords, not only the title', () => {
    expect(searchArticles(ARTICLES, 'manoperă').hits.map((h) => h.article.id)).toEqual(['quote']);
    expect(searchArticles(ARTICLES, 'expirarea').hits.map((h) => h.article.id)).toEqual(['itp']);
  });

  it('nothing for an empty query, common words only, or an unknown word', () => {
    expect(searchArticles(ARTICLES, '').hits).toEqual([]);
    expect(searchArticles(ARTICLES, 'și de la').hits).toEqual([]);
    expect(searchArticles(ARTICLES, 'zzzqqq')).toEqual({ hits: [], partial: false });
  });

  it('every word must match; otherwise the closest ones, marked partial', () => {
    const r = searchArticles(ARTICLES, 'parola zzzqqq');
    expect(r.partial).toBe(true);
    expect(r.hits[0]?.article.id).toBe('password');
  });

  it('a snippet around the word found, as plain text', () => {
    const s = snippet('## Titlu\n\nUn text **lung** despre [rovinietă](https://exemplu.ro) și ITP.', queryWords('rovinieta'));
    expect(s).toContain('rovinietă');
    expect(s).not.toMatch(/[*#[\]()]/);
  });
});

describe('what a reader sees first', () => {
  const categories: HelpCategory[] = [
    { id: 'drivers', slug: 'soferi', icon: 'car', audience: ['client'], position: 1, name: 'Pentru șoferi', description: null },
    { id: 'shops', slug: 'service-uri', icon: 'wrench', audience: ['shop'], position: 2, name: 'Pentru service-uri', description: null },
    { id: 'account', slug: 'cont', icon: 'shield', audience: [], position: 3, name: 'Cont', description: null },
  ];
  const shop: HelpReader = { staff: false, types: ['shop'], company_roles: [] };
  const client: HelpReader = { staff: false, types: ['client'], company_roles: [] };

  it('the reader’s own categories first, then the general ones, in the admin’s order', () => {
    expect(orderCategories(categories, shop).map((c) => c.slug)).toEqual(['service-uri', 'cont', 'soferi']);
    expect(orderCategories(categories, client).map((c) => c.slug)).toEqual(['soferi', 'cont', 'service-uri']);
  });

  it('relevance: own audience, everyone, other', () => {
    expect(relevance(['shop'], shop)).toBe(2);
    expect(relevance([], shop)).toBe(1);
    expect(relevance(['client'], shop)).toBe(0);
    expect(relevance(['staff'], { staff: true, types: [] })).toBe(2);
  });

  it('recommended articles and frequent questions put the reader’s own first', () => {
    const list = [
      article({ id: 'a', title: 'A', featured: true, audience: [], category_id: 'account' }),
      article({ id: 'b', title: 'B', featured: true, audience: ['shop'], category_id: 'shops' }),
      article({ id: 'c', title: 'C', featured: false, audience: ['shop'], category_id: 'shops' }),
      article({ id: 'q1', title: 'Q1', kind: 'faq', audience: [], position: 1 }),
      article({ id: 'q2', title: 'Q2', kind: 'faq', audience: ['shop'], featured: true, position: 2 }),
    ];
    expect(featuredArticles(list, shop, categories).map((a) => a.id)).toEqual(['b', 'a']);
    expect(frequentQuestions(list, shop).map((a) => a.id)).toEqual(['q2', 'q1']);
    expect(articlesOf(list, 'shops').pages.map((a) => a.id)).toEqual(['b', 'c']);
  });
});

describe('content rules (the same as help_text_ok in the database)', () => {
  const body = [10, 20000] as const;
  it('accepts Markdown with https and mailto links', () => {
    expect(helpTextProblem('Vezi [pagina](https://service-hub.ro) sau [email](mailto:a@b.ro). **Bold**.', body)).toBeNull();
    expect(helpTextProblem('Datele contului: profilul, mașinile.', body)).toBeNull();
    expect(helpTextProblem('Mai puțin de < 5 caractere aici.', body)).toBeNull();
  });
  it('refuses HTML, comments, scripts, placeholders, unsafe links and control characters', () => {
    expect(helpTextProblem('Text <b>aici</b> acum.', body)).toBe('html');
    expect(helpTextProblem('Text <!-- x --> acum.', body)).toBe('html');
    expect(helpTextProblem('Text <script>alert(1)</script>', body)).toBe('html');
    expect(helpTextProblem('Click javascript:alert(1) acum.', body)).toBe('script');
    expect(helpTextProblem('Un data:text/html,x aici.', body)).toBe('script');
    expect(helpTextProblem('Firma {{company}} aici.', body)).toBe('placeholder');
    expect(helpTextProblem('Vezi [aici](http://exemplu.ro) acum.', body)).toBe('link');
    expect(helpTextProblem('Vezi [aici](/c/garaj) acum.', body)).toBe('link');
    expect(helpTextProblem('Text\u0007 cu caracter.', body)).toBe('control');
    expect(helpTextProblem('scurt', body)).toBe('length');
  });
  it('slugs and keywords', () => {
    expect(slugify('Ștergerea contului — pași')).toBe('stergerea-contului-pasi');
    expect(parseKeywords(' ITP, rca ,itp,, Rovinietă ')).toEqual(['itp', 'rca', 'rovinietă']);
    expect(keywordsProblem(Array.from({ length: 21 }, (_, i) => `k${i}`))).toBe('count');
    expect(keywordsProblem(['a'])).toBe('keyword');
    expect(keywordsProblem(['itp', 'rca'])).toBeNull();
  });
});

describe('the first content (migration help_center)', () => {
  const migrations = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const sql = Object.entries(migrations).find(([path]) => path.endsWith('_help_center.sql'))![1];
  const calls = sql.split('select pg_temp.help_art(').slice(1);
  const quoted = (part: string) => [...part.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]!.replace(/''/g, "'"));

  const texts = calls.map((call) => {
    const bodies = [...call.matchAll(/\$b\$([\s\S]*?)\$b\$/g)].map((m) => m[1]!);
    const [beforeRo, between] = call.split(/\$b\$[\s\S]*?\$b\$/);
    const ro = quoted(beforeRo!).slice(5).filter((s) => !s.startsWith('{'));
    const en = quoted(between!).filter((s) => !s.startsWith('{'));
    return { slug: quoted(beforeRo!)[1]!, ro: [...ro, bodies[0]!], en: [...en, bodies[1]!] };
  });

  it('every category of the brief is filled, in both languages', () => {
    expect(calls.length).toBe(48);
    for (const t of texts) {
      expect(t.ro.every((s) => s.trim().length > 0), t.slug).toBe(true);
      expect(t.en.every((s) => s.trim().length > 0), t.slug).toBe(true);
    }
  });

  it('follows the editorial standard (docs/EDITORIAL.md)', () => {
    const wrong: string[] = [];
    for (const t of texts) {
      for (const text of t.ro) for (const rule of FORBIDDEN_RO) if (rule.pattern.test(text)) wrong.push(`${t.slug} (ro): ${rule.why}`);
      for (const text of t.en) for (const rule of FORBIDDEN_EN) if (rule.pattern.test(text)) wrong.push(`${t.slug} (en): ${rule.why}`);
    }
    expect(wrong).toEqual([]);
  });

  it('passes the content rules', () => {
    for (const t of texts) for (const body of [t.ro.at(-1)!, t.en.at(-1)!]) expect(helpTextProblem(body, [10, 20000]), t.slug).toBeNull();
  });
});

describe('data export', () => {
  it('lists the account’s answers to the Help Center', () => {
    const sheets = myDataSheets(
      { account: { role: 'client' }, help_feedback: [{ article: 'Programări', helpful: true, updated_at: '2026-11-12T06:00:00Z' }] },
      'ro',
    );
    const sheet = sheets.find((s) => s.name === 'Feedback articole')!;
    expect(sheet.rows[0]).toEqual(['Articol', 'Util', 'Data']);
    expect(sheet.rows[1]!.slice(0, 2)).toEqual(['Programări', 'Da']);
  });
});
