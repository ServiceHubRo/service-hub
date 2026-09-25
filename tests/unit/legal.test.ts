import { describe, expect, it } from 'vitest';
import company from '../../docs/legal/company.json';
import { isLegalField, LEGAL_DOCS, legalFieldValues, loadLegalDoc } from '../../src/lib/legal';
import { parseInline, parseMarkdown, type Block, type Inline, type ListItem } from '../../src/lib/markdown';

const LANGS = ['ro', 'en'] as const;

function inlines(blocks: Block[]): Inline[] {
  const out: Inline[] = [];
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.type === 'strong' || n.type === 'em' || n.type === 'link') walk(n.children);
    }
  };
  const walkItems = (items: ListItem[]) => {
    for (const item of items) {
      walk(item.content);
      walkItems(item.children);
    }
  };
  for (const b of blocks) {
    if (b.type === 'heading' || b.type === 'paragraph' || b.type === 'quote') walk(b.content);
    if (b.type === 'list') walkItems(b.items);
    if (b.type === 'table') [b.header, ...b.rows].forEach((row) => row.forEach(walk));
  }
  return out;
}

/** The outline a translation must keep: section headings, tables with their rows, lists. */
function outline(blocks: Block[]): string[] {
  return blocks.flatMap((b) => {
    if (b.type === 'heading') return [`h${b.level}`];
    if (b.type === 'table') return [`table ${b.header.length}×${b.rows.length}`];
    if (b.type === 'list') return [`list ${b.items.length}`];
    if (b.type === 'quote') return ['quote'];
    return [];
  });
}

describe('legal documents', () => {
  it('reads inline code and {{field}} placeholders, also inside bold text', () => {
    expect(parseInline('`sh_lang` și **{{company}}**, CUI {{cui}}')).toEqual([
      { type: 'code', text: 'sh_lang' },
      { type: 'text', text: ' și ' },
      { type: 'strong', children: [{ type: 'field', key: 'company' }] },
      { type: 'text', text: ', CUI ' },
      { type: 'field', key: 'cui' },
    ]);
  });

  for (const lang of LANGS) {
    for (const { id } of LEGAL_DOCS) {
      it(`${id} (${lang}) uses only known fields and no leftover placeholders`, async () => {
        const text = await loadLegalDoc(id, lang);
        const blocks = parseMarkdown(text);
        expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 });
        const fields = inlines(blocks).flatMap((n) => (n.type === 'field' ? [n.key] : []));
        expect(fields.length).toBeGreaterThan(0);
        for (const f of fields) expect(isLegalField(f), f).toBe(true);
        // The old drafts' "[Denumire firmă]", "[ZZ.LL.AAAA]", "[email de contact]"…
        expect(text).not.toMatch(/\[(ZZ|Denumire|CUI|email|telefon|adres|J\.\.\.)/i);
        expect(text).not.toMatch(/\{\{(?!\w+\}\})/);
      });
    }
  }

  for (const { id } of LEGAL_DOCS) {
    it(`${id}: the English version has the same outline as the Romanian one`, async () => {
      const [ro, en] = await Promise.all(LANGS.map((l) => loadLegalDoc(id, l)));
      expect(outline(parseMarkdown(en!))).toEqual(outline(parseMarkdown(ro!)));
    });
  }

  it('does not describe features the app does not have', async () => {
    const all = (await Promise.all(LANGS.flatMap((l) => LEGAL_DOCS.map((d) => loadLegalDoc(d.id, l))))).join('\n');
    // No public prices, no photo or document uploads, no work bays ("posturi"), no Start/Pro/Business plans, no ODR platform (closed in 2025).
    expect(all).not.toMatch(/posturi|încărcarea|poze|Start \/ Pro|Business\)|ec\.europa\.eu\/consumers\/odr|photos|upload/i);
  });

  it('fills the contact fields; the company fields come from docs/legal/company.json', () => {
    const values = legalFieldValues();
    expect(values.email).toBe('contact@service-hub.ro');
    expect(values.phone).toBe('0723 375 248');
    expect(Object.keys(company).sort()).toEqual(['address', 'company', 'cui', 'regcom']);
    expect(values.company).toBe(company.company.trim());
    expect(values.cui).toBe(company.cui.trim());
  });
});
