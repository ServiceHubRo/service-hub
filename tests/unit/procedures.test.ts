import { describe, expect, it } from 'vitest';
import { ADMIN_ZONES } from '../../src/app/adminZones';
import { NAV } from '../../src/app/roles';
import { PROCEDURE_CATEGORIES, type Procedure, type ProcedureContent } from '../../src/data/procedures';
import { RPC_ERROR_CODES } from '../../src/data/rpc';
import { en } from '../../src/i18n/en';
import { FORBIDDEN_EN, FORBIDDEN_RO } from '../../src/i18n/glossary';
import { ro } from '../../src/i18n/ro';
import {
  cleanContent,
  contentIn,
  contentProblems,
  filterProcedures,
  hasContent,
  looksSecret,
  NO_FILTERS,
  parseSteps,
  recentProcedures,
  searchProcedures,
  stepsText,
  toConfirm,
} from '../../src/lib/procedures';
import { newProcedurePath, procedureEditPath, procedurePath, proceduresHome, responsiblesPath } from '../../src/screens/procedures/paths';

// A5 — Internal procedures: the same content rules as the database, the language shown, the library's
// filters and search, the menus, and the first content (migration procedures) against the content
// rules and the editorial standard.

const good: ProcedureContent = {
  title: 'Cont compromis',
  applies_when: 'Titularul spune că altcineva a intrat în cont.',
  purpose: 'Accesul străin este oprit cât mai repede.',
  steps: ['Verifică solicitarea.', 'Escaladează imediat.'],
  escalation: 'Întotdeauna, imediat după pașii de mai sus.',
};

const version = (n: number, c: ProcedureContent, e: ProcedureContent | null = null, published: string | null = '2026-11-12T08:00:00Z') => ({
  id: `v${n}-${c.title}`,
  version: n,
  status: 'approved' as const,
  author: 'E-00001',
  author_id: null,
  seeded: false,
  submitted_at: null,
  approved_by: 'A-00001',
  approved_at: published,
  published_by: 'A-00001',
  published_at: published,
  created_at: '2026-11-12T07:00:00Z',
  updated_at: '2026-11-12T07:00:00Z',
  title_ro: c.title,
  title_en: e?.title ?? null,
  content_ro: c,
  content_en: e,
});

const proc = (p: Partial<Procedure> & { title: string; content?: ProcedureContent; en?: ProcedureContent | null; at?: string }): Procedure => {
  const c = p.content ?? { ...good, title: p.title };
  return {
    id: p.title,
    category: 'security',
    kind: 'usual',
    visibility: 'support',
    critical: false,
    support_categories: [],
    status: 'published',
    created_at: '2026-11-12T07:00:00Z',
    updated_at: '2026-11-12T07:00:00Z',
    responsible: null,
    published: version(1, c, p.en ?? null, p.at ?? '2026-11-12T08:00:00Z'),
    open: null,
    can_edit: false,
    ack_required: false,
    acknowledged_at: null,
    ...p,
  };
};

describe('content rules (as procedure_content_issue)', () => {
  it('a complete content has no problem; the required fields are named when empty', () => {
    expect(contentProblems(good)).toEqual({});
    expect(contentProblems({ ...good, title: ' ', escalation: '', steps: [] })).toEqual({ title: 'required', escalation: 'required', steps: 'required' });
  });

  it('no HTML, scripts, unsafe links or placeholders; lengths', () => {
    expect(contentProblems({ ...good, purpose: 'Text <b>îngroșat</b> aici.' }).purpose).toBe('html');
    expect(contentProblems({ ...good, purpose: 'Deschide [aici](javascript:alert(1)) acum.' }).purpose).toBe('script');
    expect(contentProblems({ ...good, purpose: 'Deschide [aici](http://exemplu.ro) acum.' }).purpose).toBe('link');
    expect(contentProblems({ ...good, purpose: 'Valoarea {{x}} lipsește.' }).purpose).toBe('placeholder');
    expect(contentProblems({ ...good, title: 'Ab' }).title).toBe('length');
    expect(contentProblems({ ...good, steps: ['ok'] }).steps).toBe('steps');
    expect(contentProblems({ ...good, steps: Array.from({ length: 31 }, () => 'Un pas.') }).steps).toBe('steps');
    expect(contentProblems({ ...good, steps: ['Pas <script>x</script>'] }).steps).toBe('steps');
  });

  it('no password, key, token or card number (as text_has_secret)', () => {
    expect(looksSecret('Parola: Secret123 pentru test')).toBe(true);
    expect(looksSecret('Cardul 4111 1111 1111 1111 nu se scrie.')).toBe(true);
    expect(looksSecret('token=abcd1234efgh')).toBe(true);
    expect(looksSecret('eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fwpM')).toBe(true);
    expect(looksSecret('Nu cere parole sau coduri. Programarea 0723 123 456.')).toBe(false);
    expect(looksSecret('Contul 5f0c1d2e-aaaa-bbbb-cccc-123456789012 este activ.')).toBe(false);
    expect(contentProblems({ ...good, warnings: 'Parola: Secret123 pentru test' }).warnings).toBe('secret');
    expect(contentProblems({ ...good, steps: ['Cardul 4111 1111 1111 1111 nu se scrie.'] }).steps).toBe('secret');
  });

  it('steps: one per line, list marks removed, empty lines left out, and back', () => {
    expect(parseSteps('1. Primul\n\n2) Al doilea\n- Al treilea\n  • Al patrulea  ')).toEqual(['Primul', 'Al doilea', 'Al treilea', 'Al patrulea']);
    expect(parseSteps(stepsText(good.steps))).toEqual(good.steps);
  });

  it('the content sent: trimmed, optional fields only when written', () => {
    const c = cleanContent({ ...good, title: '  Titlu  ', deadlines: ' ', warnings: ' Atenție. ', steps: ['  Pas.  ', ' '] });
    expect(c.title).toBe('Titlu');
    expect(c.steps).toEqual(['Pas.']);
    expect('deadlines' in c).toBe(false);
    expect(c.warnings).toBe('Atenție.');
    expect(hasContent({ title: '', steps: [' '] })).toBe(false);
    expect(hasContent({ title: '', steps: ['x'] })).toBe(true);
  });
});

describe('the language shown', () => {
  it('English when it exists, otherwise Romanian with a note', () => {
    const e = { ...good, title: 'Compromised account' };
    expect(contentIn('en', { content_ro: good, content_en: e })).toEqual({ content: e, fallback: false });
    expect(contentIn('en', { content_ro: good, content_en: null })).toEqual({ content: good, fallback: true });
    expect(contentIn('ro', { content_ro: good, content_en: e })).toEqual({ content: good, fallback: false });
  });
});

describe('the library', () => {
  const a = proc({ title: 'Cont compromis', kind: 'exceptional', critical: true, ack_required: true, category: 'security', at: '2026-11-10T08:00:00Z' });
  const b = proc({ title: 'Programări', category: 'bookings', at: '2026-11-12T08:00:00Z', acknowledged_at: null });
  const c = proc({ title: 'Incident', kind: 'exceptional', critical: true, ack_required: true, acknowledged_at: '2026-11-12T09:00:00Z', at: '2026-11-11T08:00:00Z' });
  const owner = { id: 'u1', display_id: 'E-00001', name: 'Ana', role: 'support' };
  const d = proc({
    title: 'Facturare',
    category: 'billing',
    responsible: { user: owner, display_id: 'E-00001', assigned_at: '2026-11-12T08:00:00Z', assigned_by: 'A-00001', needs_reassignment: false },
    open: { ...version(2, { ...good, title: 'Facturare' }), status: 'draft', approved_at: null, published_at: null },
  });
  const all = [a, b, c, d];

  it('filters by category, type, responsible, critical and in work', () => {
    expect(filterProcedures(all, { ...NO_FILTERS, category: 'security' }).map((p) => p.id)).toEqual(['Cont compromis', 'Incident']);
    expect(filterProcedures(all, { ...NO_FILTERS, kind: 'usual' }).map((p) => p.id)).toEqual(['Programări', 'Facturare']);
    expect(filterProcedures(all, { ...NO_FILTERS, responsible: 'u1' }).map((p) => p.id)).toEqual(['Facturare']);
    expect(filterProcedures(all, { ...NO_FILTERS, responsible: 'none' })).toHaveLength(3);
    expect(filterProcedures(all, { ...NO_FILTERS, critical: true })).toHaveLength(2);
    expect(filterProcedures(all, { ...NO_FILTERS, inWork: true }).map((p) => p.id)).toEqual(['Facturare']);
    expect(filterProcedures(all, NO_FILTERS)).toHaveLength(4);
  });

  it('the critical ones to confirm; the latest published first', () => {
    expect(toConfirm(all).map((p) => p.id)).toEqual(['Cont compromis']);
    expect(recentProcedures(all, 3).map((p) => p.id)).toEqual(['Programări', 'Facturare', 'Incident']);
  });

  it('searches titles and texts, diacritics ignored, in the language shown', () => {
    const hits = searchProcedures(all, 'ro', 'programari');
    expect(hits[0]?.article.procedure.id).toBe('Programări');
    expect(searchProcedures(all, 'ro', 'escaladează imediat').length).toBe(4);
    expect(searchProcedures(all, 'ro', 'zzzqqq')).toEqual([]);
    const withEn = proc({ title: 'Cont compromis', en: { ...good, title: 'Compromised account' } });
    expect(searchProcedures([withEn], 'en', 'compromised')[0]?.article.title).toBe('Compromised account');
  });
});

describe('menus, addresses, texts', () => {
  it('the agent has Proceduri in its menu; the admin under Suport', () => {
    expect(NAV.support.main.map((i) => i.path)).toContain('/suport/proceduri');
    expect(NAV.support.bottomBar).toHaveLength(5);
    const support = ADMIN_ZONES.find((z) => z.path === '/admin/suport')!;
    expect(support.items.map((i) => i.path)).toContain('/admin/suport/proceduri');
  });

  it('addresses for the agent and the admin', () => {
    expect(proceduresHome('support')).toBe('/suport/proceduri');
    expect(proceduresHome('admin')).toBe('/admin/suport/proceduri');
    expect(procedurePath('support', 'x')).toBe('/suport/proceduri/x');
    expect(procedureEditPath('admin', 'x')).toBe('/admin/suport/proceduri/x/editare');
    expect(newProcedurePath('support')).toBe('/suport/proceduri/nou');
    expect(responsiblesPath('admin')).toBe('/admin/suport/proceduri/responsabili');
  });

  it('every category, type, state and refusal has words in both languages', () => {
    for (const c of PROCEDURE_CATEGORIES) {
      expect(ro).toHaveProperty([`proc.category.${c}`]);
      expect(en).toHaveProperty([`proc.category.${c}`]);
    }
    for (const k of ['proc.kind.usual', 'proc.kind.exceptional', 'proc.status.draft', 'proc.status.pending', 'proc.status.approved', 'proc.needsApproval']) {
      expect(ro).toHaveProperty([k]);
      expect(en).toHaveProperty([k]);
    }
    for (const code of ['procedure_not_found', 'version_locked', 'version_open', 'ack_not_required'] as const) {
      expect(RPC_ERROR_CODES).toContain(code);
    }
  });
});

describe('the first content (migration procedures)', () => {
  const migrations = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const sql = Object.entries(migrations).find(([path]) => path.endsWith('_procedures.sql'))![1];
  const pairs = [...sql.matchAll(/select pg_temp\.proc\('([a-z_]+)', '(usual|exceptional)', (true|false), '\{([a-z_,]*)\}',\s*\$ro\$([\s\S]*?)\$ro\$,\s*\$en\$([\s\S]*?)\$en\$\);/g)].map(
    (m) => ({
      category: m[1]!,
      kind: m[2]!,
      critical: m[3] === 'true',
      supportCategories: m[4]!.split(',').filter(Boolean),
      ro: JSON.parse(m[5]!) as ProcedureContent,
      en: JSON.parse(m[6]!) as ProcedureContent,
    }),
  );

  it('sixteen procedures, each in Romanian and English, covering every category', () => {
    expect(pairs).toHaveLength(16);
    expect(new Set(pairs.map((p) => p.category))).toEqual(new Set(PROCEDURE_CATEGORIES));
    expect(new Set(pairs.map((p) => p.ro.title)).size).toBe(16);
  });

  it('only exceptional procedures are critical; the A3 categories exist', () => {
    const a3 = ['technical', 'account', 'bookings', 'vehicles', 'shops', 'companies', 'subscriptions', 'notifications', 'suggestions'];
    for (const p of pairs) {
      if (p.critical) expect(p.kind, p.ro.title).toBe('exceptional');
      for (const k of p.supportCategories) expect(a3, p.ro.title).toContain(k);
    }
  });

  it('every text passes the database rules, with the same steps in both languages', () => {
    for (const p of pairs) {
      expect(contentProblems(p.ro), p.ro.title).toEqual({});
      expect(contentProblems(p.en), p.en.title).toEqual({});
      expect(p.en.steps.length, p.ro.title).toBe(p.ro.steps.length);
      expect(Object.keys(p.en).sort(), p.ro.title).toEqual(Object.keys(p.ro).sort());
    }
  });

  it('follows the editorial standard', () => {
    const wrong: string[] = [];
    const texts = (c: ProcedureContent) => [c.title, c.applies_when, c.purpose, c.responsibilities, ...c.steps, c.deadlines, c.escalation, c.forbidden, c.warnings].filter(Boolean) as string[];
    for (const p of pairs) {
      for (const text of texts(p.ro)) for (const rule of FORBIDDEN_RO) if (rule.pattern.test(text)) wrong.push(`${p.ro.title} (ro): ${rule.why}: ${text}`);
      for (const text of texts(p.en)) for (const rule of FORBIDDEN_EN) if (rule.pattern.test(text)) wrong.push(`${p.en.title} (en): ${rule.why}: ${text}`);
    }
    expect(wrong).toEqual([]);
  });

  it('nothing is published by the migration', () => {
    expect(sql).not.toMatch(/insert into public\.procedures[^;]*'published'/);
    expect(sql).not.toMatch(/approved_at\s*=\s*now\(\)[^;]*seeded/);
  });
});
