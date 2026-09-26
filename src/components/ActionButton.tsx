import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n/context';
import { buttonClass, type ButtonVariant } from './buttonClass';
import { Spinner } from './Spinner';
import { useAction } from './useAction';
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
  const { run, busy, error } = useAction(onAction, { errorMessage, canRetry });
  const errorRef = useRef<HTMLDivElement>(null);

  // An error under a button at the bottom of the screen would sit below the fold: bring it in
  // (only as far as needed; nothing moves when it is already visible).
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error]);

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
        <div ref={errorRef} className={styles.error} role="alert">
          <span>{error.text}</span>
          {error.retry && (
            <button type="button" className={styles.retry} onClick={() => void run()}>
              {t('action.retry')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
