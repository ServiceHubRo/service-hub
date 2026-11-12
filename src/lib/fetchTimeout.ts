/**
 * A request to the database API or to sign-in that gets no answer (A8): on a phone that changed
 * network or woke from sleep, a request can wait for minutes without failing, and the screen keeps
 * its skeleton, or a button its spinner, with nothing to tap. After `API_TIMEOUT_MS` it fails the
 * way a lost connection fails (a `TypeError` "Failed to fetch"), so the screen shows its error with
 * „Încearcă din nou” and a write is retried with the same request id (CLAUDE.md §6.7: the server
 * returns the first result if the first attempt went through).
 *
 * Only `/rest/v1/` (database functions and reads; the database itself stops a statement after a few
 * seconds) and `/auth/v1/` (a token refresh that hangs holds back every other request). Uploads,
 * downloads and Edge Functions (files, PDFs) can take long on a slow line and are left alone.
 */
export const API_TIMEOUT_MS = 30_000;

export function timeoutFor(url: string): number | null {
  return /\/(rest|auth)\/v1\//.test(url) ? API_TIMEOUT_MS : null;
}

/** The message of the failure, matched like a lost connection by `toRpcError` (src/data/rpc.ts). */
export const TIMEOUT_MESSAGE = `Failed to fetch: no answer within ${API_TIMEOUT_MS / 1000} s`;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * `fetch` with the time limit above, for the Supabase client (`global.fetch`). A signal the caller
 * passes still cancels the request as before (its own AbortError, not a timeout).
 */
export function fetchWithTimeout(
  base: typeof fetch = (input, init) => fetch(input, init),
  limit: (url: string) => number | null = timeoutFor,
): typeof fetch {
  return (input, init) => {
    const ms = limit(urlOf(input));
    if (ms === null) return base(input, init);

    const controller = new AbortController();
    const outer = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
    const forward = () => controller.abort();
    if (outer) {
      if (outer.aborted) controller.abort();
      else outer.addEventListener('abort', forward, { once: true });
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);

    // The answer started: the limit is over (the caller's own signal still cancels reading it).
    return base(input, { ...init, signal: controller.signal }).then(
      (response) => {
        clearTimeout(timer);
        return response;
      },
      (error: unknown) => {
        clearTimeout(timer);
        outer?.removeEventListener('abort', forward);
        throw timedOut ? new TypeError(TIMEOUT_MESSAGE) : error;
      },
    );
  };
}
