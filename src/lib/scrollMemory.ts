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

/** How long after coming back to the page (or the screen changing size) a jump is suspicious. */
export const RETURN_WINDOW_MS = 2000;
/** A touch, a wheel or a key this recently means the person moved the page. */
export const TOUCH_WINDOW_MS = 1000;

/**
 * A jump to the top that nobody asked for: the content was well down, the page has just come back
 * to the front or changed size (an iPhone screenshot does both), and nobody touched it since.
 */
export function isUnaskedJump(s: { top: number; last: number; now: number; disturbedAt: number; touchedAt: number }): boolean {
  return s.top <= 1 && s.last > 80 && s.now - s.disturbedAt < RETURN_WINDOW_MS && s.now - s.touchedAt > TOUCH_WINDOW_MS;
}

/**
 * Keeps the content where it was when the browser throws it to the top by itself (Eduard, 6 Nov
 * 2026: Safari on the iPhone, after a screenshot). Only a jump right after the page comes back or
 * changes size, with no touch, is undone; the place is followed a moment while the screen redraws.
 * A new screen (another address) starts fresh.
 */
export function useKeepPlaceOnReturn(ref: RefObject<HTMLElement | null>): void {
  const { pathname, search } = useLocation();
  const last = useRef(0);

  useLayoutEffect(() => {
    last.current = ref.current?.scrollTop ?? 0;
  }, [pathname, search, ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let disturbedAt = -Infinity;
    let touchedAt = -Infinity;
    let restoring = 0;
    const disturbed = () => {
      if (document.visibilityState === 'visible') disturbedAt = performance.now();
    };
    const touched = () => {
      touchedAt = performance.now();
      cancelAnimationFrame(restoring);
      restoring = 0;
    };
    const onScroll = () => {
      if (restoring) return;
      const now = performance.now();
      if (isUnaskedJump({ top: el.scrollTop, last: last.current, now, disturbedAt, touchedAt })) {
        const target = last.current;
        const until = now + 1500;
        const follow = () => {
          if (Math.abs(el.scrollTop - target) <= 1 || performance.now() > until) {
            restoring = 0;
            return;
          }
          el.scrollTo(0, target);
          restoring = requestAnimationFrame(follow);
        };
        restoring = requestAnimationFrame(follow);
        return;
      }
      last.current = el.scrollTop;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', disturbed);
    window.addEventListener('pageshow', disturbed);
    window.addEventListener('resize', disturbed);
    window.visualViewport?.addEventListener('resize', disturbed);
    for (const type of ['touchstart', 'wheel', 'keydown', 'pointerdown'] as const) document.addEventListener(type, touched, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(restoring);
      el.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', disturbed);
      window.removeEventListener('pageshow', disturbed);
      window.removeEventListener('resize', disturbed);
      window.visualViewport?.removeEventListener('resize', disturbed);
      for (const type of ['touchstart', 'wheel', 'keydown', 'pointerdown'] as const) document.removeEventListener(type, touched, { capture: true });
    };
  }, [ref]);
}
