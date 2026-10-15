import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { motionOn } from './motion';

export type Slide = 'none' | 'fade' | 'forward' | 'back';

/** The area a screen belongs to: `/c/programari/…` → `/c/programari` (one bottom-bar item). */
function area(pathname: string): string {
  return pathname.split('/').slice(0, 3).join('/');
}

function depth(pathname: string): number {
  return pathname.split('/').filter(Boolean).length;
}

/**
 * How the next screen comes in (Eduard, 15 Oct): another bottom-bar item fades in; a screen
 * deeper in the same item slides in from the right, and going back slides in from the left, as
 * on an iPhone. Only the address's query changing (a filter, a tab) moves nothing.
 */
export function slideFor(prev: string, next: string, back: boolean): Slide {
  if (prev === next) return 'none';
  if (area(prev) !== area(next)) return 'fade';
  if (back || depth(next) < depth(prev)) return 'back';
  return 'forward';
}

const FRAMES: Record<Exclude<Slide, 'none'>, Keyframe[]> = {
  fade: [{ opacity: 0 }, { opacity: 1 }],
  forward: [
    { opacity: 0, transform: 'translateX(28px)' },
    { opacity: 1, transform: 'none' },
  ],
  back: [
    { opacity: 0, transform: 'translateX(-28px)' },
    { opacity: 1, transform: 'none' },
  ],
};

/** Plays the slide on `ref` (the shell's content) whenever the screen changes (motion.ts, screenSlide). */
export function useScreenSlide(ref: RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const prev = useRef(pathname);

  useLayoutEffect(() => {
    const slide = slideFor(prev.current, pathname, navigationType === 'POP');
    prev.current = pathname;
    const el = ref.current;
    if (slide === 'none' || !el || typeof el.animate !== 'function' || !motionOn('screenSlide')) return;
    const animation = el.animate(FRAMES[slide], {
      duration: slide === 'fade' ? 160 : 240,
      easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
    });
    return () => animation.cancel();
  }, [pathname, navigationType, ref]);
}
