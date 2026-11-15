import { expect, type Page } from '@playwright/test';
import { measurePatterns } from './patternRules';

/**
 * Field rules (Eduard, 14 Nov 2026: „vreau să fie verificat fiecare câmp posibil”, after the procedure
 * editor showed a one-line field narrower than the text areas under it). Measured in the browser on
 * every screen the visual audit and the accessibility walk open:
 *
 *  F1 row       fields side by side in one group are equally wide (two per row: two equal halves);
 *  F2 column    rows of fields stacked in one group start and end at the same edges, or line up
 *               column by column like a grid (no field narrower than the one above it, no ragged
 *               right edge);
 *  F3 height    one-line fields side by side are equally high;
 *  F4 inside    a field never sticks out of the card or panel it is in;
 *  F5 text      a field's text is at least 16 px (iPhone zooms in otherwise);
 *  F6 label     every field has a label (visible, or for a search box, read by a screen reader);
 *  F7 label-at  a label above its field starts where the field starts.
 *
 * The lines of a quote are a table (`data-fields="table"`): F1 and F2 do not apply inside.
 *
 * A "field" is the whole of it: label, box and hint (the Field, SelectField, TextArea, PhoneField,
 * CheckMenu wrappers), so a phone number with its country code counts once.
 */

export interface FieldIssue {
  rule: string;
  detail: string;
}

/** Runs inside the page: self-contained, nothing from outside the function. */
export function measureFields(): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const add = (rule: string, detail: string) => {
    if (issues.length < 40 && !issues.some((i) => i.rule === rule && i.detail === detail)) issues.push({ rule, detail });
  };
  const px = (n: number) => Math.round(n);
  const quiet = (el: Element) => !!el.closest('[aria-hidden="true"], [hidden], .visually-hidden, [inert], [data-tour-shade]');
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
  };
  const bordered = (el: Element) => {
    const cs = getComputedStyle(el);
    return parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0;
  };

  const controls = Array.from(document.querySelectorAll<HTMLElement>('input, select, textarea, button[aria-haspopup], button[aria-controls][aria-expanded][class*="input"]')).filter((el) => {
    const type = (el as HTMLInputElement).type;
    if (el.tagName === 'INPUT' && ['checkbox', 'radio', 'hidden', 'file', 'range', 'color', 'submit', 'button', 'image', 'reset'].includes(type)) return false;
    if (el.tagName === 'BUTTON' && !/(^|\s|_)input(_|\s|$)/.test(el.className)) return false;
    return !quiet(el) && shown(el);
  });

  /** The box a person sees: the control, or the first bordered element around it (a search box). */
  const boxOf = (el: HTMLElement): HTMLElement => {
    if (bordered(el)) return el;
    let p: HTMLElement | null = el.parentElement;
    for (let i = 0; i < 3 && p; i++, p = p.parentElement) if (bordered(p)) return p;
    return el;
  };
  const labelOf = (el: HTMLElement): HTMLElement | null => {
    const own = (el as HTMLInputElement).labels?.[0];
    if (own) return own;
    const by = el.getAttribute('aria-labelledby');
    return by ? document.getElementById(by.split(/\s+/)[0]!) : null;
  };
  const common = (a: Element, b: Element): Element | null => {
    for (let p: Element | null = a; p; p = p.parentElement) if (p.contains(b)) return p;
    return null;
  };
  const depth = (from: Element, to: Element) => {
    let d = 0;
    for (let p: Element | null = from; p && p !== to; p = p.parentElement) d++;
    return d;
  };
  const name = (el: Element) => {
    const label = labelOf(el as HTMLElement);
    const text = (label?.textContent ?? el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.getAttribute('name') ?? el.tagName.toLowerCase())
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 40);
    return `„${text}”`;
  };

  interface Unit {
    control: HTMLElement;
    box: HTMLElement;
    unit: HTMLElement;
    r: DOMRect;
    br: DOMRect;
    oneLine: boolean;
  }
  const units: Unit[] = [];
  const seen = new Set<Element>();
  for (const control of controls) {
    const box = boxOf(control);
    const label = labelOf(control);
    let unit: HTMLElement = box;
    if (label && !quiet(label) && shown(label)) {
      const c = common(control, label);
      // The label belongs to this field only when they are close (a wrapper, not the whole form).
      if (c instanceof HTMLElement && depth(control, c) <= 4 && c.querySelectorAll('input, select, textarea').length <= 2) unit = c;
    }
    if (!unit.contains(box)) unit = box;
    if (seen.has(unit)) continue;
    seen.add(unit);
    units.push({ control, box, unit, r: unit.getBoundingClientRect(), br: box.getBoundingClientRect(), oneLine: control.tagName !== 'TEXTAREA' });

    // F5, F6, F7 — one field at a time.
    const cs = getComputedStyle(control);
    if (control.tagName !== 'BUTTON' && parseFloat(cs.fontSize) < 16) add('F5 text', `${name(control)} ${cs.fontSize}`);
    const named = !!label || !!control.getAttribute('aria-label') || !!control.getAttribute('aria-labelledby') || !!control.getAttribute('title');
    if (!named) add('F6 label', `${name(control)} has no label`);
    if (label && shown(label) && !quiet(label) && unit !== box) {
      // The first box of the field (a phone number starts with its country code).
      const first = Math.min(
        ...[unit, ...Array.from(unit.querySelectorAll('*'))]
          .filter((el) => el !== label && !label.contains(el) && bordered(el) && shown(el))
          .map((el) => el.getBoundingClientRect().left),
      );
      const lr = label.getBoundingClientRect();
      if (Number.isFinite(first) && lr.bottom <= box.getBoundingClientRect().top + 1 && Math.abs(lr.left - first) > 2) {
        add('F7 label-at', `${name(control)} label at ${px(lr.left)}, field at ${px(first)}`);
      }
    }
  }

  // F4 — inside its card: no ancestor that draws a box (border or background) is narrower than the field.
  for (const u of units) {
    for (let p = u.unit.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const drawn = bordered(p) || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent');
      if (!drawn || cs.overflowX !== 'visible') continue;
      const pr = p.getBoundingClientRect();
      if (u.br.right > pr.right + 1 || u.br.left < pr.left - 1) {
        add('F4 inside', `${name(u.control)} ${px(u.br.left)}…${px(u.br.right)} outside its box ${px(pr.left)}…${px(pr.right)}`);
      }
      break;
    }
  }

  // Groups: fields close in the page structure (a form, a card, a filter bar). The lines of a quote
  // are a table (`data-fields="table"`): their columns are sized by what they hold.
  const table = (u: Unit) => !!u.unit.closest('[data-fields="table"]');
  const near = (a: Unit, b: Unit) => {
    const c = common(a.unit, b.unit);
    return !!c && depth(a.unit, c) <= 4 && depth(b.unit, c) <= 4;
  };
  const sameRow = (a: Unit, b: Unit) => Math.abs(a.r.top - b.r.top) <= 4 && (a.r.right <= b.r.left + 1 || b.r.right <= a.r.left + 1);

  // Rows: fields side by side.
  const sorted = [...units].sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
  const rows: Unit[][] = [];
  for (const u of sorted) {
    if (table(u)) continue;
    const row = rows.find((rw) => rw.some((v) => sameRow(u, v) && near(u, v)));
    if (row) row.push(u);
    else rows.push([u]);
  }
  for (const row of rows) {
    if (row.length < 2) continue;
    row.sort((a, b) => a.r.left - b.r.left);
    const widths = row.map((u) => u.r.width);
    if (Math.max(...widths) - Math.min(...widths) > 2) {
      add('F1 row', row.map((u) => `${name(u.control)} ${px(u.r.width)}`).join(' | '));
    }
    const lines = row.filter((u) => u.oneLine).map((u) => u.br.height);
    if (lines.length > 1 && Math.max(...lines) - Math.min(...lines) > 1) {
      add('F3 height', row.filter((u) => u.oneLine).map((u) => `${name(u.control)} ${px(u.br.height)}`).join(' | '));
    }
  }

  // F2 — rows stacked in one group: the same left and right edges.
  const span = (row: Unit[]) => ({ left: Math.min(...row.map((u) => u.r.left)), right: Math.max(...row.map((u) => u.r.right)) });
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i]!;
    const b = rows[i + 1]!;
    if (!a.some((u) => b.some((v) => near(u, v)))) continue;
    const sa = span(a);
    const sb = span(b);
    if (Math.abs(sa.left - sb.left) > 2) continue;
    // A shorter row of a grid is fine when each of its fields sits exactly under (or over) a field
    // of the longer row: the columns line up (the company's „Adaugă vehicul”).
    const [short, long] = sa.right - sa.left < sb.right - sb.left ? [a, b] : [b, a];
    const aligned = short.every((u) => long.some((v) => Math.abs(u.r.left - v.r.left) <= 2 && Math.abs(u.r.width - v.r.width) <= 2));
    if (Math.abs(sa.right - sb.right) > 2 && !aligned) {
      add('F2 column', `${a.map((u) => name(u.control)).join(' + ')} ends at ${px(sa.right)}, ${b.map((u) => name(u.control)).join(' + ')} at ${px(sb.right)}`);
    }
  }
  return issues;
}

/**
 * Fails with what breaks one of `rules` (codes such as 'F2', 'P4') on the screen as it is now: the
 * field rules here and the patterns of ./patternRules.ts.
 */
export async function expectConsistent(page: Page, where: string, rules: readonly string[]) {
  const fields = await page.evaluate(measureFields);
  const { findings } = await page.evaluate(measurePatterns, rules);
  const broken = [...fields, ...findings].filter((i) => rules.includes(i.rule.split(' ')[0]!)).map((i) => `${i.rule}: ${i.detail}`);
  expect(broken, `docs/MODEL_DE_FOLOSIRE.md on ${where}`).toEqual([]);
}
