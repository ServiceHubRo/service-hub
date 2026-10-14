/**
 * Scroll animations on the public page (Eduard, 14 Oct): a part comes to life once, when the
 * visitor reaches it. Turned off here: false shows the page as it was, with nothing hidden.
 */
export const LANDING_MOTION = true;

/** How far into the screen a part must come before it starts (12% above the bottom edge). */
const ROOT_MARGIN = '0px 0px -12% 0px';

/**
 * Marks every `[data-reveal]` inside `root` with `data-shown` when it comes on screen; the CSS
 * animates only under `[data-motion]`. Parts already on screen are shown at once (no flash), and
 * nothing is hidden when the phone asks for less motion or the browser cannot tell what is on
 * screen. Returns the cleanup.
 */
export function revealOnScroll(root: HTMLElement, enabled = LANDING_MOTION): () => void {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (!enabled || reduce || typeof IntersectionObserver === 'undefined') return () => {};

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.shown = '';
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: ROOT_MARGIN },
  );
  const fold = window.innerHeight * 0.88;
  for (const el of root.querySelectorAll<HTMLElement>('[data-reveal]')) {
    if (el.getBoundingClientRect().top < fold) el.dataset.shown = '';
    else observer.observe(el);
  }
  root.dataset.motion = '';
  return () => {
    observer.disconnect();
    delete root.dataset.motion;
  };
}
