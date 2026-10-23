import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { slideFor } from './screenSlide';

/** Where each screen was scrolled to, for this visit of the app. */
const positions = new Map<string, number>();

/**
 * The content area's scroll (Eduard, 19 Oct): a new screen starts at the top; going back (the
 * phone's or browser's back, or "‹ Cont" up to the screen before) finds the screen where it was
 * left. A screen still loading is scrolled there as its content arrives, unless the person
 * scrolls first.
 */
export function useScrollMemory(ref: RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const current = useRef(pathname);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const remember = () => positions.set(current.current, el.scrollTop);
    el.addEventListener('scroll', remember, { passive: true });
    return () => el.removeEventListener('scroll', remember);
  }, [ref]);

  useLayoutEffect(() => {
    const prev = current.current;
    current.current = pathname;
    const el = ref.current;
    if (!el || prev === pathname) return;
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
    el.addEventListener('wheel', stop, { passive: true });
    el.addEventListener('touchstart', stop, { passive: true });
    el.addEventListener('keydown', stop);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('wheel', stop);
      el.removeEventListener('touchstart', stop);
      el.removeEventListener('keydown', stop);
    };
  }, [pathname, navigationType, ref]);
}
