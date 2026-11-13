import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { slideFor } from './screenSlide';

/** Where each screen was scrolled to, for this visit of the app. */
const positions = new Map<string, number>();

/** The page's own scrolling (the app scrolls the document, not an area inside it). */
function pageScroller(): HTMLElement {
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * The page's scroll (Eduard, 19 Oct): a new screen starts at the top; going back (the phone's or
 * browser's back, or "‹ Cont" up to the screen before) finds the screen where it was left. A screen
 * still loading is scrolled there as its content arrives, unless the person scrolls first.
 *
 * Since 6 Nov 2026 the document scrolls, not the app's content area: Safari on the iPhone kept the
 * page's place at a screenshot but threw an inner scrolling area back to the top.
 *
 * Used once, for every screen (App, ScrollMemory), since 13 Nov 2026: in the signed-in shell alone
 * it went away with the shell, and signing out opened the public page at the offset of Cont.
 */
export function useScrollMemory(): void {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const current = useRef(pathname);

  // The app decides where a screen opens; the browser's own restoring would fight it.
  useEffect(() => {
    if (!('scrollRestoration' in history)) return;
    const before = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => {
      history.scrollRestoration = before;
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
