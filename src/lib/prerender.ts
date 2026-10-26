// The public page drawn ahead at build time (T46): `npm run build` renders `/` to HTML
// (src/prerender.tsx, scripts/prerender.mjs), so a search engine and a slow phone get the text
// at once. In the browser React takes over that same HTML instead of drawing the page again.

/** The attribute on #root while it holds the page drawn at build time. */
export const PRERENDERED_ATTR = 'data-prerendered';

let fromPrerender = typeof window === 'undefined';

/** Set once on start (main.tsx) when React takes over the HTML drawn at build time. */
export function markHydrating(): void {
  fromPrerender = true;
}

/**
 * True while drawing at build time, and in the browser when the page arrived drawn: the public
 * page then shows itself during the first session check instead of the loading screen, as in the
 * HTML (React would otherwise replace it, and the page would blink).
 */
export function fromPrerenderedPage(): boolean {
  return fromPrerender;
}
