/**
 * The way back inside the app (P1, 6 Nov 2026). A „‹ Înapoi” used to open its parent page as a new
 * history entry, so the browser's Back and the in-app back took turns and looped (Cont → Firmele mele
 * → Cont → …). Now the in-app back goes back in the history when the entry before is the parent page,
 * and otherwise replaces the current entry with the parent (a link opened directly, a page reached
 * another way): it never adds an entry.
 *
 * React Router keeps the position of each entry in `history.state.idx`; the address of each position
 * is kept here, per tab (sessionStorage survives a refresh; private mode falls back to memory).
 */

const KEY = 'sh_nav_entries';
const LIMIT = 200;
let memory: Record<string, string> = {};

function read(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : memory;
  } catch {
    return memory;
  }
}

function write(entries: Record<string, string>) {
  memory = entries;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage blocked: the memory copy is enough for this page's life.
  }
}

/** The position of the current entry, as React Router set it; null outside a browser router. */
export function currentIndex(): number | null {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : null;
}

/** Remembers the address of the current entry (called on every navigation). */
export function recordEntry(path: string) {
  const idx = currentIndex();
  if (idx === null) return;
  const entries = read();
  entries[String(idx)] = path;
  // Entries far behind are of no use; the store stays small.
  for (const k of Object.keys(entries)) if (Number(k) < idx - LIMIT || Number(k) > idx + LIMIT) delete entries[k];
  write(entries);
}

/** The address of the entry just before the current one, when known. */
export function previousEntry(): string | null {
  const idx = currentIndex();
  if (idx === null || idx < 1) return null;
  return read()[String(idx - 1)] ?? null;
}

/**
 * Whether an address is the target page: the same path, and the same query when the target names one
 * (`/c/firme/x?sectiune=vehicule` is not `/c/firme/x?sectiune=panou`).
 */
export function isSamePlace(address: string, target: string): boolean {
  const a = new URL(address, 'https://x.invalid');
  const b = new URL(target, 'https://x.invalid');
  if (a.pathname.replace(/\/+$/, '') !== b.pathname.replace(/\/+$/, '')) return false;
  if (!b.search) return true;
  const want = new URLSearchParams(b.search);
  const have = new URLSearchParams(a.search);
  for (const [k, v] of want) if (have.get(k) !== v) return false;
  return true;
}

/** Back to `target`: through the history when it is the entry before, else in place of this entry. */
export function goUp(navigate: (to: string | number, options?: { replace?: boolean }) => void, target: string) {
  const prev = previousEntry();
  if (prev !== null && isSamePlace(prev, target)) navigate(-1);
  else navigate(target, { replace: true });
}
