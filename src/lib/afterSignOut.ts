/**
 * Signing out on purpose (Cont, the sidebar, the expired-session panel, a deleted account) replaces
 * the address with the public page while the page is still scrolled where „Deconectare” was — the
 * end of Cont on a phone — and the public page sets no place of its own, so it opened at that
 * offset, at „Pentru șoferi” (Eduard, 13 Nov 2026). The first public page drawn after it opens at
 * its very top instead.
 *
 * In memory only, used once: a reload, back and forward keep their own behavior (the browser's,
 * src/lib/scrollMemory.ts).
 */
let openAtTop = false;

/** Called right before leaving for the public page. */
export function markSigningOut(): void {
  openAtTop = true;
}

/** True once, for the first public page after signing out. */
export function takeOpenAtTop(): boolean {
  const open = openAtTop;
  openAtTop = false;
  return open;
}
