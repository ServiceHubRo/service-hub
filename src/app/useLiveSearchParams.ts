import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, type NavigateOptions } from 'react-router-dom';

/**
 * `useSearchParams` for screens whose switches, checkboxes and dropdowns live in the address.
 * The router renders a new address a moment later (in a transition), so a controlled switch would
 * snap back for a frame and then flip. Here the new value shows at once and the address follows.
 */
export function useLiveSearchParams(): [URLSearchParams, (next: URLSearchParams, options?: NavigateOptions) => void] {
  const [params, setParams] = useSearchParams();
  const [pending, setPending] = useState<string | null>(null);
  const key = params.toString();
  const [seen, setSeen] = useState(key);
  // The address caught up (or changed by Back): it is the truth again.
  if (seen !== key) {
    setSeen(key);
    setPending(null);
  }
  const setRef = useRef(setParams);
  useEffect(() => {
    setRef.current = setParams;
  }, [setParams]);
  const set = useCallback((next: URLSearchParams, options?: NavigateOptions) => {
    setPending(next.toString());
    setRef.current(next, options);
  }, []);
  return [pending === null ? params : new URLSearchParams(pending), set];
}
