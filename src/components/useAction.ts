import { useRef, useState } from 'react';
import { useI18n } from '../i18n/context';
import { newRequestId } from '../lib/requestId';

export interface ActionOptions {
  /** Maps an error to a translated message; defaults to the generic network message. */
  errorMessage?: (error: unknown) => string;
  /** Whether "Încearcă din nou" makes sense for this error. Default: always. */
  canRetry?: (error: unknown) => boolean;
}

export interface ActionError {
  text: string;
  retry: boolean;
}

/**
 * The write rules of CLAUDE.md §6.7, shared by ActionButton and icon-only write buttons
 * (FavoriteButton): one submission at a time, a request id kept for retries (the server returns
 * the first result if an earlier attempt went through), a translated error for an inline message.
 */
export function useAction(onAction: (requestId: string) => Promise<unknown>, { errorMessage, canRetry }: ActionOptions = {}) {
  const { t } = useI18n();
  const busyRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  async function run() {
    if (busyRef.current) return;
    busyRef.current = true;
    requestIdRef.current ??= newRequestId();
    setBusy(true);
    setError(null);
    try {
      await onAction(requestIdRef.current);
      requestIdRef.current = null;
    } catch (e) {
      const retry = canRetry ? canRetry(e) : true;
      // A different answer next time needs a new request id (e.g. after fixing a typo).
      if (!retry) requestIdRef.current = null;
      setError({ text: errorMessage ? errorMessage(e) : t('action.error'), retry });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return { run, busy, error };
}
