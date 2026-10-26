import { useEffect } from 'react';

/**
 * Tells search engines not to list this page while it is shown (T46): an address that does not
 * exist still answers like the app, so without it Google could list "Pagina nu există".
 */
export function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}
