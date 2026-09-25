import { useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { InlinePanel } from '../../components/InlinePanel';
import { TextArea } from '../../components/TextArea';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import styles from './admin.module.css';

/**
 * An inline confirm panel with an optional or required text (a reason, a note), a confirm button
 * and "Renunță" (ARCHITECTURE §17: never a dialog). `onConfirm` gets the text and the request id.
 */
export function ConfirmPanel({
  title,
  body,
  textLabel,
  textHint,
  textRequired,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  textLabel?: string;
  textHint?: string;
  textRequired?: boolean;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (text: string, requestId: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { t, lang } = useI18n();
  const [text, setText] = useState('');
  const [missing, setMissing] = useState(false);
  return (
    <InlinePanel title={title}>
      {body && <p className={danger ? styles.warning : styles.muted}>{body}</p>}
      {textLabel && (
        <TextArea
          label={textLabel}
          hint={textHint}
          value={text}
          maxLength={textRequired ? 500 : 1000}
          rows={3}
          error={missing ? t('admin.reasonRequired') : null}
          onChange={(e) => {
            setText(e.target.value);
            if (missing) setMissing(false);
          }}
        />
      )}
      <div className={styles.panelButtons}>
        <ActionButton
          variant={danger ? 'danger' : 'primary'}
          onAction={async (requestId) => {
            if (textRequired && !text.trim()) {
              setMissing(true);
              return;
            }
            await onConfirm(text.trim(), requestId);
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {confirmLabel}
        </ActionButton>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </InlinePanel>
  );
}
