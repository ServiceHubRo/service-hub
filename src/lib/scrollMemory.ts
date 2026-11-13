import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { slideFor } from './screenSlide';

/** Where each screen was scrolled to, for this visit of the app. */
const positions = new Map<string, number>();

/** The page's own scrolling (the app scrolls the document, not an area inside it). */
function pageScroller(): HTMLElement {
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** Signed-in shells on screen (useScrollMemory): while one is, the app decides where a screen opens. */
let shells = 0;
/** A reload being opened at its top: the browser must not put the page back where it was. */
let reloading = false;

/** The browser's own restoring: off in the signed-in app and during a reload, on everywhere else. */
function applyRestoration(): void {
  if (!('scrollRestoration' in history)) return;
  history.scrollRestoration = shells > 0 || reloading ? 'manual' : 'auto';
}

function isReload(): boolean {
  const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav) return nav.type === 'reload';
  // Older Safari has only the first version of the API (1 = a reload).
  return performance.navigation?.type === 1;
}

/**
 * A reload (F5, the browser's reload, pull to refresh) opens the page at its top, on every page
 * (Eduard, 13 Nov 2026): on the public pages the browser put it back where it was left (its own
 * restoring, 'auto' there); in the signed-in app it already opened at the top ('manual'). index.html
 * turns the browser's restoring off for a reload before anything is drawn; here the page is put at
 * the top, and once it has loaded the restoring is what it was, so Back and Forward are unchanged.
 * Only a reload: no other way into a page and no move between screens is touched. Called once, at
 * start (main.tsx).
 */
export function openReloadAtTop(): void {
  if (!isReload()) return;
  reloading = true;
  applyRestoration();
  window.scrollTo(0, 0);
  const release = () =>
    requestAnimationFrame(() => {
      reloading = false;
      applyRestoration();
    });
  let variant = '0';
  try {
    variant = localStorage.getItem('sh_reload_variant') ?? '0';
  } catch {
    // investigation only
  }
  if (variant === '2') {
    // Back on just before the first move away from the reloaded page.
    const push = history.pushState;
    const replace = history.replaceState;
    const before = () => {
      history.pushState = push;
      history.replaceState = replace;
      reloading = false;
      applyRestoration();
    };
    history.pushState = function (...args: Parameters<History['pushState']>) {
      before();
      return push.apply(this, args);
    };
    history.replaceState = function (...args: Parameters<History['replaceState']>) {
      before();
      return replace.apply(this, args);
    };
    return;
  }
  if (document.readyState === 'complete') release();
  else window.addEventListener('load', release, { once: true });
}

/**
 * The page's scroll (Eduard, 19 Oct): a new screen starts at the top; going back (the phone's or
 * browser's back, or "‹ Cont" up to the screen before) finds the screen where it was left. A screen
 * still loading is scrolled there as its content arrives, unless the person scrolls first.
 *
 * Since 6 Nov 2026 the document scrolls, not the app's content area: Safari on the iPhone kept the
 * page's place at a screenshot but threw an inner scrolling area back to the top.
 */
export function useScrollMemory(): void {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const current = useRef(pathname);

  // The app decides where a screen opens; the browser's own restoring would fight it. Back to the
  // browser's when the shell goes (signing out), whatever a reload had set meanwhile.
  useEffect(() => {
    shells += 1;
    applyRestoration();
    return () => {
      shells -= 1;
      applyRestoration();
    };
  }, []);

  useEffect(() => {
    const remember = () => positions.set(current.current, pageScroller().scrollTop);
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, []);

  useLayoutEffect(() => {
    const prev = current.current;
    current.current = pathname;
    if (prev === pathname) return;
    const el = pageScroller();
    const back = navigationType === 'POP' || slideFor(prev, pathname, false) === 'back';
    const target = back ? (positions.get(pathname) ?? 0) : 0;
    el.scrollTo(0, target);
    if (target <= 0) return;

    // The screen may still be loading (shorter than the place it was left at): follow it a moment.
    let stopped = false;
    const stop = () => {
      stopped = true;
    };
    const until = performance.now() + 1500;
    let frame = requestAnimationFrame(function follow() {
      if (stopped || Math.abs(el.scrollTop - target) <= 1 || performance.now() > until) return;
      el.scrollTo(0, target);
      frame = requestAnimationFrame(follow);
    });
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
    };
  }, [pathname, navigationType]);
}
