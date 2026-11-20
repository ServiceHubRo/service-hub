import { useSyncExternalStore } from 'react';

/** Whether a media query matches now, kept up to date (false where there is no window). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener('change', onChange);
      return () => list?.removeEventListener('change', onChange);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}

/** The width from which a list stands beside its detail (page template A; the sidebar's width too). */
export const LIST_DETAIL_QUERY = '(min-width: 1024px)';

/** From here a form's buttons sit in one row (save and cancel on the right, delete on the left). */
export const FOOT_ROW_QUERY = '(min-width: 600px)';
