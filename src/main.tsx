import { StrictMode, type ErrorInfo } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './app/App';
import { ChunkLoadError } from './app/routes/lazyChunk';
import { IS_TEST_BUILD } from './lib/env';
import { keyboardReadoutAsked, resizeForKeyboard, watchKeyboard } from './lib/keyboard';
import { captureError, installGlobalHandlers } from './lib/monitoring';
import { markHydrating, PRERENDERED_ATTR } from './lib/prerender';
import { openReloadAtTop } from './lib/scrollMemory';
import '@fontsource-variable/inter/wght.css';
import './styles/tokens.css';
import './styles/global.css';

// A reload opens the page at its top (src/lib/scrollMemory.ts); nothing else is touched.
openReloadAtTop();

resizeForKeyboard();
// The phone's keyboard, on every screen and platform (the bottom bar steps aside, the field stays seen).
watchKeyboard();
// Its measurements on screen, for a screenshot from a real phone: test builds only, asked with ?kb=1.
const visitStorage = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};
if (IS_TEST_BUILD && keyboardReadoutAsked(window.location.search, visitStorage())) {
  void import('./lib/keyboardReadout').then((m) => m.showKeyboardReadout());
}

// Error reports (T19): nothing is sent unless the build has VITE_SENTRY_DSN.
installGlobalHandlers();

/** An error while drawing a screen: shown by the nearest error boundary, reported here. */
function reportRenderError(error: unknown, info: ErrorInfo) {
  console.error(error);
  if (error instanceof ChunkLoadError) {
    // Usually no connection; worth a look only when the browser thinks it is online.
    if (navigator.onLine) captureError(error, { level: 'warning', tags: { mechanism: 'chunk' } });
    return;
  }
  captureError(error, { tags: { mechanism: 'react' }, extra: { componentStack: info.componentStack?.slice(0, 2000) } });
}

const container = document.getElementById('root')!;
const options = { onCaughtError: reportRenderError, onUncaughtError: reportRenderError };
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// The public page arrived drawn at build time (T46) and index.html kept it for this visitor:
// React takes over that HTML (nothing is drawn twice, the animations keep running).
if (container.hasAttribute(PRERENDERED_ATTR)) {
  markHydrating();
  hydrateRoot(container, app, options);
} else {
  createRoot(container, options).render(app);
}
