/**
 * A small Markdown reader for the legal documents (docs/legal/*.md): headings, paragraphs,
 * lists (one nesting level), block quotes, tables, rules, **bold**, *italic* and [links](url).
 * It produces plain data that React renders as elements, never as HTML strings.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] };

export interface ListItem {
  content: Inline[];
  children: ListItem[];
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; content: Inline[] }
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'list'; ordered: boolean; items: ListItem[] }
  | { type: 'quote'; content: Inline[] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'rule' };

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*?)\*/;
  while (rest.length > 0) {
    const m = pattern.exec(rest);
    if (!m) {
      out.push({ type: 'text', text: rest });
      break;
    }
    if (m.index > 0) out.push({ type: 'text', text: rest.slice(0, m.index) });
    if (m[1] !== undefined) out.push({ type: 'strong', children: parseInline(m[1]) });
    else if (m[2] !== undefined && m[3] !== undefined) {
      if (SAFE_HREF.test(m[3])) out.push({ type: 'link', href: m[3], children: parseInline(m[2]) });
      else out.push(...parseInline(m[2]));
    } else if (m[4] !== undefined) out.push({ type: 'em', children: parseInline(m[4]) });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed === '') {
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length as 1 | 2 | 3 | 4, content: parseInline(heading[2]!) });
      i++;
      continue;
    }
    if (trimmed.startsWith('>')) {
      const parts: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        parts.push(lines[i]!.trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', content: parseInline(parts.join(' ')) });
      continue;
    }
    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[i + 1]!.trim())) {
      const header = cells(trimmed).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(cells(lines[i]!).map(parseInline));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    const first = LIST_ITEM.exec(line);
    if (first) {
      const ordered = /\d/.test(first[2]!);
      const baseIndent = first[1]!.length;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]!);
        if (!m) {
          // A wrapped line continues the previous item.
          if (lines[i]!.trim() !== '' && items.length > 0 && /^\s+/.test(lines[i]!)) {
            const last = items[items.length - 1]!;
            last.content.push({ type: 'text', text: ' ' }, ...parseInline(lines[i]!.trim()));
            i++;
            continue;
          }
          break;
        }
        const item: ListItem = { content: parseInline(m[3]!), children: [] };
        if (m[1]!.length > baseIndent && items.length > 0) items[items.length - 1]!.children.push(item);
        else items.push(item);
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const parts: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!.trim();
      if (l === '' || /^(#{1,4})\s/.test(l) || l.startsWith('>') || l.startsWith('|') || LIST_ITEM.test(lines[i]!) || /^(-{3,}|\*{3,})$/.test(l)) break;
      parts.push(l);
      i++;
    }
    blocks.push({ type: 'paragraph', content: parseInline(parts.join(' ')) });
  }
  return blocks;
}
