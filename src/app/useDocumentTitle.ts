import { useEffect } from 'react';

/**
 * The browser tab (and a screen reader after navigation) names the page: "Programări · Service-Hub".
 * `null` leaves the title to a screen that sets its own (a 404 inside the shell).
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (title === null) return;
    document.title = title.includes('Service-Hub') ? title : `${title} · Service-Hub`;
  }, [title]);
}
