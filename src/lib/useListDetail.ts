import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LIST_DETAIL_QUERY, useMediaQuery } from './useMediaQuery';

interface OpenedFromList {
  listDetail?: boolean;
}

/**
 * Which item of a list + detail screen is open (page template A), kept in the address (`?id=` by
 * default) so a link, a notification or Back finds it.
 * - From 1024 px the list stands beside the detail: with nothing chosen the first item is shown and
 *   written in the address, and choosing another replaces the address (Back leaves the screen, not
 *   the item).
 * - Below, the detail takes the screen: choosing an item adds a step to the history, so the
 *   phone's Back (and „Înapoi”) returns to the list, scrolled where it was.
 */
/** The state a screen was opened with (where the way back leads), kept when an item is chosen. */
function stateOf(state: unknown): object {
  return state && typeof state === 'object' ? state : {};
}

export function useListDetail(ids: readonly string[], param = 'id', options: { autoSelect?: boolean; anyId?: boolean } = {}) {
  // An item whose opening is recorded (a support request in the audit log) is never opened for the
  // reader: beside the list nothing is shown until one is chosen.
  const autoSelect = options.autoSelect ?? true;
  const wide = useMediaQuery(LIST_DETAIL_QUERY);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const asked = params.get(param);
  // `anyId`: an item opened from elsewhere (a link, a counter) stays open even when the list on screen
  // (a filter, a page) does not hold it.
  const known = asked !== null && (options.anyId || ids.includes(asked)) ? asked : null;
  const selectedId = known ?? (wide && autoSelect ? (ids[0] ?? null) : null);
  const open = !wide && known !== null;
  const listScroll = useRef(0);

  const select = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      next.set(param, id);
      if (wide) {
        // The anchor of the address (`#lista`) stays: only the chosen item changes.
        navigate({ search: `?${next.toString()}`, hash: window.location.hash }, { replace: true, preventScrollReset: true, state: location.state });
        return;
      }
      listScroll.current = window.scrollY;
      navigate({ search: `?${next.toString()}`, hash: window.location.hash }, { state: { ...stateOf(location.state), listDetail: true } satisfies OpenedFromList });
    },
    [params, param, wide, navigate, location.state],
  );

  const back = useCallback(() => {
    if ((location.state as OpenedFromList | null)?.listDetail) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete(param);
    navigate({ search: `?${next.toString()}`, hash: window.location.hash }, { replace: true, state: location.state });
  }, [location.state, navigate, params, param]);

  // Beside the list, the item shown first is written in the address like a chosen one: it stays
  // open when it changes under the reader (a booking that ends while it is read moves to the other
  // tab, and the screen follows it there instead of showing another item).
  const first = ids[0] ?? null;
  useEffect(() => {
    if (!wide || !autoSelect || known !== null || first === null) return;
    // The address as it is now: a screen that keeps its filters live (useLiveSearchParams) shows a
    // filter at once while the router renders the new address a moment later, so `params` can still be
    // the old one, and writing it back would undo the filter just chosen.
    const next = new URLSearchParams(window.location.search);
    if (next.get(param) === first) return;
    next.set(param, first);
    navigate({ search: `?${next.toString()}`, hash: window.location.hash }, { replace: true, preventScrollReset: true, state: location.state });
  }, [wide, autoSelect, known, first, params, param, navigate, location.state]);

  // The detail opens at its top; the list comes back where it was.
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    window.scrollTo(0, open ? 0 : listScroll.current);
  }, [open]);

  return { wide, selectedId, open, select, back };
}
