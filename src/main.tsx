import { StrictMode, type ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ChunkLoadError } from './app/routes/lazyChunk';
import { captureError, installGlobalHandlers } from './lib/monitoring';
import './styles/tokens.css';
import './styles/global.css';

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

createRoot(document.getElementById('root')!, {
  onCaughtError: reportRenderError,
  onUncaughtError: reportRenderError,
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
