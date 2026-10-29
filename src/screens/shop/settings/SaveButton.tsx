import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionButton } from '../../../components/ActionButton';
import { rpcErrorMessage } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import styles from './settings.module.css';

/**
 * The save button of a settings page: an ActionButton that reads "✓ Salvat" for 1.5 s after a
 * save (P5). `onSave` returns false when the form did not validate (nothing was sent).
 *
 * T51: by default a quiet bar held at the bottom of the screen across the whole content width, the
 * button on the right (full width on a phone) and an optional note on the left ("Modificări
 * nesalvate"). `footer` puts it at the end of a section instead, on the right, for a page that saves
 * more than one thing (the week of Program și zile libere).
 */
export function SaveButton({
  onSave,
  children,
  disabled,
  note,
  footer,
}: {
  onSave: (requestId: string) => Promise<boolean | void>;
  children: ReactNode;
  disabled?: boolean;
  note?: ReactNode;
  footer?: boolean;
}) {
  const { t, lang } = useI18n();
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div className={footer ? styles.saveFooter : styles.saveBar} data-span="all">
      {note && <div className={styles.saveNote}>{note}</div>}
      <div className={styles.saveAction}>
      <ActionButton
        disabled={disabled}
        errorMessage={(e) => rpcErrorMessage(lang, e)}
        onAction={async (requestId) => {
          setSaved(false);
          const ok = await onSave(requestId);
          if (ok === false) return;
          setSaved(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setSaved(false), 1500);
        }}
      >
        {saved ? t('common.saved') : children}
      </ActionButton>
      </div>
      <span className="visually-hidden" role="status">
        {saved ? t('common.saved') : ''}
      </span>
    </div>
  );
}
