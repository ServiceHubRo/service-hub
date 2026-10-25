import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { App } from './app/App';
import { homeHeadTags } from './lib/seoFiles';

/**
 * The HTML of a public page as the browser first draws it, with no session yet (T46). Built with
 * `vite build --ssr` and called by scripts/prerender.mjs; the browser takes it over (main.tsx).
 */
export function renderPage(path: string): string {
  return renderToString(
    <StrictMode>
      <App location={path} />
    </StrictMode>,
  );
}

/** The canonical address and structured data of `/`, for the <head> of the page drawn (T46). */
export function headTags(): string {
  return homeHeadTags(__SITE_URL__);
}
