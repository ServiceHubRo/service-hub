/**
 * The app's height on the iPhone. Safari (iOS 26) does not always keep `height: 100%` equal to
 * what can be seen: after a while (the keyboard, the address bar growing and shrinking) the page
 * ran under Safari's toolbar, which showed a white strip over the tab bar and took its taps
 * (Eduard, 10 Oct). There the height follows `window.innerHeight` (the area between Safari's
 * bars, the keyboard aside) through `--app-height` (global.css); elsewhere nothing changes.
 */
export function isIOS(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): boolean {
  // iPadOS presents itself as a Mac; it is told apart by its touch screen.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}

/** Keeps `--app-height` on <html> equal to the visible height. Returns the cleanup. */
export function trackAppHeight(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): () => void {
  if (!isIOS(ua, touchPoints)) return () => {};
  const root = document.documentElement;
  const set = () => root.style.setProperty('--app-height', `${window.innerHeight}px`);
  // Safari may leave the page scrolled after the keyboard went; a page that fits never should be.
  let timer = 0;
  const afterKeyboard = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      set();
      if (root.scrollHeight <= window.innerHeight + 1 && window.scrollY !== 0) window.scrollTo(0, 0);
    }, 300);
  };
  set();
  window.addEventListener('resize', set);
  window.visualViewport?.addEventListener('resize', set);
  window.addEventListener('pageshow', set);
  document.addEventListener('focusout', afterKeyboard);
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener('resize', set);
    window.visualViewport?.removeEventListener('resize', set);
    window.removeEventListener('pageshow', set);
    document.removeEventListener('focusout', afterKeyboard);
    root.style.removeProperty('--app-height');
  };
}
