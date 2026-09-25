import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

/**
 * Filters kept in the address (Back and reload keep them). `setParam` starts from the address as it
 * is right now, so a chip tapped while the typing timer fires never loses either change. The search
 * text is kept locally while typing and written to the address after a short pause.
 *
 * A change arriving after the admin has already left the screen (the pause ends while another
 * screen opens) is dropped: written then, it would navigate back to this list.
 */
export function useUrlParams(textKey = 'q') {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const ownPath = useRef(pathname);
  const setParamsRef = useRef(setParams);
  useEffect(() => {
    setParamsRef.current = setParams;
  }, [setParams]);

  const setParam = useCallback((changes: Record<string, string | null>) => {
    if (window.location.pathname !== ownPath.current) return;
    const current = window.location.search.replace(/^\?/, '');
    const next = new URLSearchParams(current);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (next.toString() !== current) setParamsRef.current(next, { replace: true });
  }, []);

  const [text, setText] = useState(() => params.get(textKey) ?? '');
  useEffect(() => {
    const id = window.setTimeout(() => setParam({ [textKey]: text.trim() ? text : null }), 250);
    return () => window.clearTimeout(id);
  }, [text, setParam, textKey]);

  return { params, setParam, text, setText };
}
