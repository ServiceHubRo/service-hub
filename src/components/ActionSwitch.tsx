import { useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/context';
import { Switch } from './Switch';
import { useAction } from './useAction';
import actionStyles from './ActionButton.module.css';
import styles from './ActionSwitch.module.css';

export interface ActionSwitchProps {
  checked: boolean;
  /** Saves the new state. Receives the request id to pass to the RPC as `p_request_id`. */
  onToggle: (next: boolean, requestId: string) => Promise<unknown>;
  children: ReactNode;
  /** A line under the label (what on and off mean). */
  hint?: ReactNode;
  disabled?: boolean;
  errorMessage?: (error: unknown) => string;
  canRetry?: (error: unknown) => boolean;
}

/**
 * A switch that saves at once (Eduard, 10 Oct: on / off is a switch, never a button): the same
 * write rules as ActionButton (CLAUDE.md §6.7) — locked while saving, one submission, an inline
 * error with "Încearcă din nou" — showing the new state while it is being saved.
 */
export function ActionSwitch({ checked, onToggle, children, hint, disabled, errorMessage, canRetry }: ActionSwitchProps) {
  const { t } = useI18n();
  // What the tap asked for: the ref for the write (and its retry), the state for what is shown.
  const target = useRef(!checked);
  const [asked, setAsked] = useState(!checked);
  const { run, busy, error } = useAction((requestId) => onToggle(target.current, requestId), { errorMessage, canRetry });

  return (
    <div className={styles.wrap}>
      <Switch
        checked={busy ? asked : checked}
        disabled={disabled || busy}
        aria-busy={busy}
        hint={hint}
        onChange={(e) => {
          target.current = e.target.checked;
          setAsked(e.target.checked);
          void run();
        }}
      >
        {children}
      </Switch>
      {error && (
        <div className={actionStyles.error} role="alert">
          <span>{error.text}</span>
          {error.retry && (
            <button type="button" className={actionStyles.retry} onClick={() => void run()}>
              {t('action.retry')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
