import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionButton } from '../../../components/ActionButton';
import { rpcErrorMessage } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';

/**
 * The save button of a settings section: an ActionButton that reads "✓ Salvat" for 1.5 s after a
 * save (P5). `onSave` returns false when the form did not validate (nothing was sent).
 */
export function SaveButton({
  onSave,
  children,
  disabled,
}: {
  onSave: (requestId: string) => Promise<boolean | void>;
  children: ReactNode;
  disabled?: boolean;
}) {
  const { t, lang } = useI18n();
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
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
      <span className="visually-hidden" role="status">
        {saved ? t('common.saved') : ''}
      </span>
    </>
  );
}
