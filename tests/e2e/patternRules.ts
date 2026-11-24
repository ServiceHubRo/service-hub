/**
 * The consistency audit (Eduard, 14 Nov 2026: „totul să fie la fel peste tot … toți să aibă aceeași
 * experiență pe fiecare cont”). On every screen the visual audit opens, this records which shared
 * pattern each part of the page is built with (the `data-ui` mark of the components in
 * src/components) and what is built by hand next to them, so the report can compare the same kind
 * of thing across the client, company, shop, support and admin accounts.
 *
 * Runs inside the page: self-contained.
 */

export interface PatternFinding {
  rule: string;
  detail: string;
}

export interface Patterns {
  /** How many of each shared component are on the screen. */
  used: Record<string, number>;
  /** Heights of buttons and of one-line fields, in px, with how many of each. */
  buttonHeights: Record<string, number>;
  fieldHeights: Record<string, number>;
  /** Font sizes of the headings (h1, h2, h3). */
  headings: Record<string, string[]>;
  /** Corner radius and padding of cards. */
  cards: Record<string, number>;
  findings: PatternFinding[];
}

/** `only`: the rule codes to measure (all of them when left out; the sizes only then). */
export function measurePatterns(only?: readonly string[]): Patterns {
  const want = (...codes: string[]) => !only || codes.some((c) => only.includes(c));
  const out: Patterns = { used: {}, buttonHeights: {}, fieldHeights: {}, headings: {}, cards: {}, findings: [] };
  const add = (rule: string, detail: string) => {
    if (out.findings.filter((f) => f.rule === rule).length < 12 && !out.findings.some((f) => f.rule === rule && f.detail === detail)) {
      out.findings.push({ rule, detail });
    }
  };
  const quiet = (el: Element) => !!el.closest('[aria-hidden="true"], [hidden], .visually-hidden, [inert], [data-tour-shade], [data-ui="skeleton"]');
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
  };
  const text = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const main = document.querySelector('main') ?? document.body;
  const inMain = (el: Element) => main.contains(el);
  const count = (rec: Record<string, number>, key: string) => {
    rec[key] = (rec[key] ?? 0) + 1;
  };
  const ui = (el: Element | null) => el?.closest('[data-ui]')?.getAttribute('data-ui') ?? null;

  for (const el of only ? [] : Array.from(document.querySelectorAll('[data-ui]'))) {
    if (quiet(el) || !shown(el)) continue;
    count(out.used, el.getAttribute('data-ui')!);
  }

  // P1 — the title of the screen is the shared page header.
  if (want('P1')) {
    const h1s = Array.from(main.querySelectorAll('h1')).filter((h) => !quiet(h) && shown(h));
    // On a phone an item of a list opens on the whole screen with its own head (page template A).
    if (h1s.length === 0 && !main.querySelector('[data-ui="detail-pane"]')) add('P1 title', 'no title (h1) on the screen');
    if (h1s.length > 1) add('P1 title', `${h1s.length} titles (h1)`);
    // The page header, or one of the headers of a kind of its own, the same on every account
    // (docs/MODEL_DE_FOLOSIRE.md): a conversation, a shop's page, a step of booking, a request sent,
    // the garage's car card (Eduard, 14 Nov 2026: exactly the company's „Adaugă vehicul”).
    const HEADERS =
      '[data-ui="page-header"], [data-ui="conversation-header"], [data-ui="shop-header"], [data-ui="step-header"], [data-ui="success"], [data-ui="form-card"], [data-ui="legal-document"]';
    for (const h of h1s) if (!h.closest(HEADERS)) add('P1 title', `„${text(h)}” is not in the page header`);

    for (const level of ['h1', 'h2', 'h3'] as const) {
      for (const h of Array.from(main.querySelectorAll(level))) {
        if (quiet(h) || !shown(h)) continue;
        const cs = getComputedStyle(h);
        const key = `${cs.fontSize}/${cs.fontWeight}`;
        const seenSizes = (out.headings[level] ??= []);
        if (!seenSizes.includes(key)) seenSizes.push(key);
      }
    }
  }

  // P2 — „Înapoi” is the shared back link, above the title.
  if (want('P2')) {
    for (const a of Array.from(main.querySelectorAll('a, button'))) {
      if (quiet(a) || !shown(a)) continue;
      const t = text(a);
      // An empty state's action („Înapoi în aplicație”) is a button of that state, not a back link.
      if (/^(‹\s*)?(Înapoi|Back)\b/i.test(t) && !a.closest('[data-ui="back-link"], [data-ui="empty-state"]')) add('P2 back', `„${t}” is not the shared back link`);
    }
  }

  // P3 — choosing what a list shows: tabs (Tabs) or a list to choose from (SelectField), never chips.
  if (want('P3')) {
    const chipRows = new Set<Element>();
    for (const b of Array.from(main.querySelectorAll('button[aria-pressed]'))) {
      if (quiet(b) || !shown(b)) continue;
      if (b.closest('[role="dialog"], dialog')) continue; // inside the filter sheet: options of a filter
      chipRows.add(b.parentElement!);
    }
    for (const row of chipRows) {
      const items = Array.from(row.querySelectorAll(':scope > button[aria-pressed]')).filter((b) => shown(b));
      if (items.length >= 2) add('P3 chips', `chips: ${items.map(text).slice(0, 4).join(' · ')}`);
    }
    for (const tl of Array.from(main.querySelectorAll('[role="tablist"]'))) {
      if (quiet(tl) || !shown(tl)) continue;
      if (!tl.closest('[data-ui="tabs"]') && tl.getAttribute('data-ui') !== 'tabs') add('P3 tabs', `tabs built by hand: ${Array.from(tl.querySelectorAll('[role="tab"]')).map(text).slice(0, 4).join(' · ')}`);
    }
  }

  // P4 — buttons are the shared Button / ActionButton (or a shared control that has its own).
  if (want('P4', 'P5')) {
    const ownButtons = ['stat-tile', 'composer', 'diagram', 'button', 'action-button', 'chip', 'tabs', 'menu', 'filters-button', 'search', 'check-menu', 'stepper', 'back-link', 'list-row', 'tile', 'disclosure', 'checkbox', 'switch', 'phone', 'field', 'select'];
    const amber = (cs: CSSStyleDeclaration) => /rgb\(245, 165, 36\)/.test(cs.backgroundColor);
    let primaries = 0;
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('button, a[href], [role="button"]'))) {
      if (quiet(b) || !shown(b) || !inMain(b)) continue;
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      const inText = cs.display.startsWith('inline') && Array.from(b.parentElement?.childNodes ?? []).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      if (inText) continue;
      // A choice (a service to tick, a day, a category that opens) is an option, not an action button.
      const choice = ['aria-pressed', 'aria-checked', 'aria-expanded', 'aria-selected'].some((a) => b.hasAttribute(a)) || b.getAttribute('role') === 'tab';
      const owner = ui(b);
      const looksLikeButton = parseFloat(cs.borderTopWidth) > 0 || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent');
      if (b.tagName === 'BUTTON' && !choice && !owner && looksLikeButton && r.height >= 30) add('P4 button', `„${text(b) || b.getAttribute('aria-label')}” is a button built by hand`);
      if (owner && !choice && !ownButtons.includes(owner) && b.tagName === 'BUTTON' && looksLikeButton && r.height >= 30 && !b.closest('[data-ui="button"], [data-ui="action-button"]')) {
        add('P4 button', `„${text(b) || b.getAttribute('aria-label')}” is a button built by hand inside ${owner}`);
      }
      // A panel opened in the page is its own small context: its confirm button may be filled; an add
    // top right (the page header or a section's head, P12) is always filled.
    if (amber(cs) && !(b as HTMLButtonElement).disabled && !b.closest('[data-ui="inline-panel"], [data-ui="page-header"], [data-ui="section-head"]')) {
        primaries++;
        if (primaries === 2) add('P5 primary', 'more than one filled (amber) button on the screen');
      }
      if (owner === 'button' || owner === 'action-button' || amber(cs) || looksLikeButton) count(out.buttonHeights, String(Math.round(r.height)));
    }
    if (primaries > 1) add('P5 primary', `${primaries} filled buttons`);
  }

  // P6 — fields are the shared Field / SelectField / TextArea / SearchField / PhoneField / CheckMenu.
  if (want('P6')) {
    // The message box of a conversation and a choice made on a card (a payment period, a quote's
  // variant) are shared pieces of their own (docs/MODEL_DE_FOLOSIRE.md).
  const fieldUis = ['field', 'select', 'textarea', 'search', 'phone', 'check-menu', 'checkbox', 'switch', 'stepper', 'composer', 'choice'];
    for (const c of Array.from(main.querySelectorAll<HTMLElement>('input, select, textarea'))) {
      if (quiet(c) || !shown(c)) continue;
      const type = (c as HTMLInputElement).type;
      if (['hidden', 'file'].includes(type)) continue;
      const owner = ui(c);
      if (!owner || !fieldUis.includes(owner)) add('P6 field', `${c.tagName.toLowerCase()} ${type ?? ''} „${c.getAttribute('aria-label') ?? (c as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? c.getAttribute('placeholder') ?? ''}” is built by hand`);
      if (c.tagName !== 'TEXTAREA' && !['checkbox', 'radio', 'range'].includes(type)) count(out.fieldHeights, String(Math.round(c.getBoundingClientRect().height)));
    }
  }

  // P7 — a status is the shared StatusPill.
  if (want('P7')) {
    // Any small rounded label with words (a status, a role, a state) that is not the shared pill.
    for (const el of Array.from(main.querySelectorAll<HTMLElement>('span, strong, em, small, p, div'))) {
      if (quiet(el) || !shown(el) || el.closest('[data-ui="status-pill"], [data-ui="day"], button, a, [role="button"], [data-ui="chip"]')) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const filled = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      const round = parseFloat(cs.borderTopLeftRadius) >= r.height / 2 - 1;
      const words = /\p{L}{2,}/u.test(text(el));
      if (filled && round && words && r.height >= 14 && r.height <= 32 && r.width < 320) add('P7 status', `„${text(el)}” is a pill built by hand`);
    }
  }

  // P8 — a list of items is rows (ListRow) or a grid of equal cards (CardGrid), not a stack of cards.
  if (want('P8')) {
    // Cards of one list have the same build (the same elements inside); the sections of a page do not.
    const shape = (el: Element, depth = 2): string =>
      depth === 0 ? el.tagName : `${el.tagName}(${Array.from(el.children).map((c) => shape(c, depth - 1)).join(',')})`;
    const stacks = new Map<string, Element[]>();
    const listIds = new Map<Element, number>();
    for (const c of Array.from(main.querySelectorAll('[data-ui="card"]'))) {
      if (quiet(c) || !shown(c) || c.closest('[data-ui="inline-panel"], [data-ui="detail-pane"], [data-ui="card-grid"]')) continue;
      const cs = getComputedStyle(c);
      count(out.cards, `r${cs.borderTopLeftRadius} p${cs.paddingTop}`);
      const parent = c.parentElement!;
      const list = parent.tagName === 'LI' ? parent.parentElement! : parent;
      if (!listIds.has(list)) listIds.set(list, listIds.size);
      const key = `${listIds.get(list)}|${shape(c)}`;
      stacks.set(key, [...(stacks.get(key) ?? []), c]);
    }
    for (const cards of stacks.values()) {
      // Side by side in a grid (two or more columns) is a grid of cards, not a list.
      const lefts = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left)));
      if (cards.length >= 3 && lefts.size === 1) add('P8 list', `${cards.length} cards one after another (${text(cards[0]!).slice(0, 30)}…): a list built from cards`);
    }
  }

  // P13 — on a phone the buttons of one place are one family: those side by side share the row in
  // equal parts and fill it; those one under another are equally wide (Eduard, 21 Nov 2026, from
  // the Android app: „Salvează” on the whole width and „Renunță” narrow, PDF buttons not filling
  // the row, „Lasă o recenzie” wider than „Mai multe”).
  if (want('P13') && window.innerWidth < 600) {
    // An ActionButton is a button inside its own wrapper (with the error line under it); a menu too.
    const unitOf = (el: HTMLElement) => (el.matches('[data-ui="action-button"]') ? el.parentElement ?? el : el.closest<HTMLElement>('[data-ui="menu"]') ?? el);
    const groups = new Map<Element, HTMLElement[]>();
    const skip = '[data-ui="page-header"], [data-ui="section-head"], [data-ui="tabs"], [data-ui="list-row"], [data-ui="chip"], [data-ui="stepper"], [data-ui="switch"], [data-ui="checkbox"], [data-ui="filters-button"], [data-ui="search"], [data-ui="back-link"], [data-ui="tile"], nav, [role="tablist"]';
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('[data-ui="button"], [data-ui="action-button"], [data-ui="menu"] > button, a[class*="button"]'))) {
      if (quiet(b) || !shown(b) || b.closest(skip) || !(b.getBoundingClientRect().height >= 40)) continue;
      // A text-only (ghost) button is a quiet link next to the real buttons, not one of them.
      if (/ghost/.test(b.className)) continue;
      // Text around it: a link inside a sentence, not an action.
      if (Array.from(b.parentElement?.childNodes ?? []).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '')) continue;
      const unit = unitOf(b);
      const parent = unit.parentElement;
      if (!parent) continue;
      groups.set(parent, [...(groups.get(parent) ?? []), unit]);
    }
    for (const [parent, units] of groups) {
      const items = Array.from(new Set(units));
      if (items.length < 2) continue;
      const pr = parent.getBoundingClientRect();
      const pcs = getComputedStyle(parent);
      const inner = pr.right - (parseFloat(pcs.paddingRight) || 0);
      const rows: HTMLElement[][] = [];
      for (const u of items.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left)) {
        const last = rows[rows.length - 1];
        if (last && Math.abs(last[0]!.getBoundingClientRect().top - u.getBoundingClientRect().top) < 8) last.push(u);
        else rows.push([u]);
      }
      const widths = (row: HTMLElement[]) => row.map((u) => Math.round(u.getBoundingClientRect().width));
      const name = (u: HTMLElement) => `„${text(u)}”`;
      const where = ui(parent) ?? parent.tagName.toLowerCase();
      for (const row of rows) {
        const w = widths(row);
        if (row.length > 1 && Math.max(...w) - Math.min(...w) > 8) add('P13 buttons', `${row.map(name).join(' + ')} share a row unequally (${w.join(' / ')} px) in ${where}`);
        const right = Math.max(...row.map((u) => u.getBoundingClientRect().right));
        if (row.length > 1 && inner - right > 12) add('P13 buttons', `${row.map(name).join(' + ')} do not fill their row (${Math.round(inner - right)} px left) in ${where}`);
      }
      if (rows.length > 1) {
        const all = rows.flatMap(widths);
        if (Math.max(...all) - Math.min(...all) > 8 && rows.every((r) => r.length === 1)) add('P13 buttons', `${items.map(name).join(' / ')} one under another with different widths (${all.join(' / ')} px) in ${where}`);
      }
    }
  }

  // P9 — loading is the skeleton; an empty list or an error is the shared empty state. (A bar of
  // steps done, „0 din 4”, is progress, not loading.)
  if (want('P9')) {
    for (const el of Array.from(main.querySelectorAll('[aria-busy="true"]'))) {
      if (!shown(el) || el.closest('[data-ui="skeleton"], [data-ui="action-button"]')) continue;
      add('P9 state', `a loading state that is not the skeleton (${el.tagName.toLowerCase()})`);
    }
  }

  // P10 — a menu of more actions is the shared „Mai multe”.
  if (want('P10')) {
    for (const b of Array.from(main.querySelectorAll('button[aria-haspopup="menu"], button[aria-haspopup="true"]'))) {
      if (shown(b) && !b.closest('[data-ui="menu"]')) add('P10 menu', `„${text(b) || b.getAttribute('aria-label')}” opens a menu built by hand`);
    }
  }

  // P12 — an add (a car, a colleague, an expense, a category…) sits top right: in the page header for
  // the whole page, in the head of its section for a section (Eduard, 15 Nov 2026: „toate butoanele
  // de adăugare … în dreapta sus”). A form's own button, an empty state's and a panel's are not adds
  // of the page.
  if (want('P12')) {
    // An add: its „+” drawing (Plus, UserPlus, CalendarPlus, ImagePlus…), or „Adaugă …”, „Invită …”,
    // „Procedură nouă”, „Add …”, „New procedure” (never „Verifică din nou”). JavaScript's \b does not
    // know „ă”, so the words end with a space or the end.
    const ADD = /^(Adaugă|Invită|Add|Invite)(\s|$)|^(?!din\s)\p{L}+ (nou|nouă)$|^New \p{L}+$/u;
    const plusIcon = (el: Element) => !!el.querySelector('svg[class*="plus"]');
    for (const b of Array.from(main.querySelectorAll<HTMLElement>('button, a[href]'))) {
      if (quiet(b) || !shown(b)) continue;
      const t = text(b);
      if (!ADD.test(t) && !plusIcon(b)) continue;
      // A form's own button (its submit, its save bar) is not an add of the page.
      if ((b as HTMLButtonElement).type === 'submit' || b.closest('[data-fixed-bottom], [data-ui="inline-panel"]')) continue;
      // A row of a list opens its item: whatever its title says (a text that starts with „Adaugă …”) it is not an add.
      if (b.closest('[data-ui="page-header"], [data-ui="section-head"], [data-ui="empty-state"], [data-ui="stepper"], [data-ui="list-row"], [role="menu"], dialog, [data-ui="filter-sheet"]')) continue;
      add('P12 add', `„${t}” is not top right`);
    }
  }

  // P12 (header) — the page header has one action at the most, top right, next to the whole title
  // (Eduard, 24 Nov 2026: Proceduri interne and Centrul de ajutor had two stacked buttons). A second
  // action of the page goes beside the search or the list it belongs to.
  if (want('P12')) {
    for (const h of Array.from(main.querySelectorAll<HTMLElement>('[data-ui="page-header"]'))) {
      if (quiet(h) || !shown(h)) continue;
      const own = Array.from(h.querySelectorAll<HTMLElement>('button, a[href]')).filter((b) => shown(b) && !h.firstElementChild?.contains(b) && !b.closest('[role="menu"]'));
      if (own.length > 1) add('P12 header', `${own.length} actions in the page header: ${own.map((b) => `„${text(b) || b.getAttribute('aria-label')}”`).join(' + ')}`);
    }
  }

  // P11 — a confirmation or a form opened from a button is an inline panel, not a dialog.
  if (want('P11')) {
    for (const d of Array.from(document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"]'))) {
      if (!shown(d)) continue;
      if (d.getAttribute('data-ui') === 'filter-sheet') continue;
      const title = d.querySelector('h1, h2, h3');
      add('P11 dialog', `a dialog: „${title ? text(title) : text(d).slice(0, 30)}”`);
    }
  }
  return out;
}

/**
 * The rules every screen must already keep (docs/MODEL_DE_FOLOSIRE.md): checked on every screen of
 * every role, in Romanian and English, at 390 / 820 / 1440 px (tests/e2e/a11y.spec.ts), so a pull
 * request that breaks one fails. A rule joins this list once the audit finds it nowhere broken
 * (docs/AUDIT_CONSISTENTA.md); the others are fixed one by one, then added here.
 */
export const ENFORCED_RULES: readonly string[] = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'P1', 'P2', 'P3', 'P4', 'P6', 'P7', 'P9', 'P10', 'P11', 'P12'];
