import { useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/context';
import { newRequestId } from '../lib/requestId';
import { buttonClass, type ButtonVariant } from './buttonClass';
import { Spinner } from './Spinner';
import styles from './ActionButton.module.css';

export interface ActionButtonProps {
  /** Performs the write. Receives the request id to pass to the RPC as `p_request_id`. */
  onAction: (requestId: string) => Promise<unknown>;
  children: ReactNode;
  variant?: ButtonVariant;
  block?: boolean;
  disabled?: boolean;
  /** Maps an error to a translated message; defaults to the generic network message. */
  errorMessage?: (error: unknown) => string;
  /** Whether "Încearcă din nou" makes sense for this error (not for a wrong password). Default: always. */
  canRetry?: (error: unknown) => boolean;
  /** The form's submit button: Enter in a field of the form triggers it. */
  submit?: boolean;
}

/**
 * Every write goes through this button (CLAUDE.md §6.7): it locks on tap, shows a spinner
 * without changing width, submits once, and shows an inline error with "Try again".
 * A retry reuses the same request id, so the server returns the first result if the
 * earlier attempt actually went through.
 */
export function ActionButton({
  onAction,
  children,
  variant = 'primary',
  block = true,
  disabled,
  errorMessage,
  canRetry,
  submit,
}: ActionButtonProps) {
  const { t } = useI18n();
  const busyRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; retry: boolean } | null>(null);

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

  return (
    <div className={block ? styles.wrapBlock : styles.wrap}>
      <button
        type={submit ? 'submit' : 'button'}
        className={buttonClass(variant, block, styles.action)}
        onClick={(e) => {
          if (submit) e.preventDefault();
          void run();
        }}
        disabled={disabled || busy}
        aria-busy={busy}
        aria-label={busy ? t('action.sending') : undefined}
      >
        <span className={busy ? styles.hidden : undefined}>{children}</span>
        {busy && (
          <span className={styles.spinner} aria-hidden="true">
            <Spinner />
          </span>
        )}
      </button>
      {error && (
        <div className={styles.error} role="alert">
          <span>{error.text}</span>
          {error.retry && (
            <button type="button" className={styles.retry} onClick={run}>
              {t('action.retry')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
