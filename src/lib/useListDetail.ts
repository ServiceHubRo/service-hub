import { useCallback, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LIST_DETAIL_QUERY, useMediaQuery } from './useMediaQuery';

interface OpenedFromList {
  listDetail?: boolean;
}

/**
 * Which item of a list + detail screen is open (page template A), kept in the address (`?id=` by
 * default) so a link, a notification or Back finds it.
 * - From 1024 px the list stands beside the detail: with nothing chosen the first item is shown,
 *   and choosing another replaces the address (Back leaves the screen, not the item).
 * - Below, the detail takes the screen: choosing an item adds a step to the history, so the
 *   phone's Back (and „Înapoi”) returns to the list, scrolled where it was.
 */
export function useListDetail(ids: readonly string[], param = 'id') {
  const wide = useMediaQuery(LIST_DETAIL_QUERY);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const asked = params.get(param);
  const known = asked !== null && ids.includes(asked) ? asked : null;
  const selectedId = known ?? (wide ? (ids[0] ?? null) : null);
  const open = !wide && known !== null;
  const listScroll = useRef(0);

  const select = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      next.set(param, id);
      if (wide) {
        setParams(next, { replace: true, preventScrollReset: true });
        return;
      }
      listScroll.current = window.scrollY;
      navigate({ search: `?${next.toString()}` }, { state: { listDetail: true } satisfies OpenedFromList });
    },
    [params, param, wide, setParams, navigate],
  );

  const back = useCallback(() => {
    if ((location.state as OpenedFromList | null)?.listDetail) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete(param);
    setParams(next, { replace: true });
  }, [location.state, navigate, params, param, setParams]);

  // The detail opens at its top; the list comes back where it was.
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    window.scrollTo(0, open ? 0 : listScroll.current);
  }, [open]);

  return { wide, selectedId, open, select, back };
}
