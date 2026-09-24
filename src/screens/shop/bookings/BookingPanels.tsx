import { useState } from 'react';
import { ActionButton } from '../../../components/ActionButton';
import { Button } from '../../../components/Button';
import { InlinePanel } from '../../../components/InlinePanel';
import { TextArea } from '../../../components/TextArea';
import { canRetryRpc, rpcErrorMessage } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import styles from './shopBookings.module.css';

export const REASON_MAX = 500;

/** The inline panel every card action opens (no dialogs). */
export const Panel = InlinePanel;

/** The confirming write and "Renunță", side by side. */
export function PanelButtons({
  label,
  variant = 'primary',
  disabled,
  onAction,
  onClose,
}: {
  label: string;
  variant?: 'primary' | 'success' | 'danger';
  disabled?: boolean;
  onAction: (requestId: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  return (
    <div className={styles.panelButtons}>
      <ActionButton
        variant={variant}
        block={false}
        disabled={disabled}
        onAction={onAction}
        errorMessage={(e) => rpcErrorMessage(lang, e)}
        canRetry={canRetryRpc}
      >
        {label}
      </ActionButton>
      <Button variant="ghost" onClick={onClose}>
        {t('common.cancel')}
      </Button>
    </div>
  );
}

/** A question and one confirming write (no-show, withdraw the quote). */
export function ConfirmPanel({
  title,
  body,
  label,
  onAction,
  onClose,
}: {
  title: string;
  body: string;
  label: string;
  onAction: (requestId: string) => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <Panel title={title}>
      <p className={styles.panelBody}>{body}</p>
      <PanelButtons label={label} variant="danger" onAction={onAction} onClose={onClose} />
    </Panel>
  );
}

/** Decline (reason optional) or cancel (reason required); the client reads the reason. */
export function ReasonPanel({
  title,
  body,
  label,
  required,
  onAction,
  onClose,
}: {
  title: string;
  body: string;
  label: string;
  required: boolean;
  onAction: (reason: string, requestId: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel title={title}>
      <p className={styles.panelBody}>{body}</p>
      <TextArea
        label={required ? t('sb.reason.required') : t('sb.reason.optional')}
        hint={t('sb.reason.hint')}
        value={reason}
        maxLength={REASON_MAX}
        rows={3}
        error={error}
        onChange={(e) => {
          setReason(e.target.value);
          if (error) setError(null);
        }}
      />
      <PanelButtons
        label={label}
        variant="danger"
        onAction={async (requestId) => {
          const text = reason.trim();
          if (required && text === '') {
            setError(t('sb.reason.missing'));
            return;
          }
          await onAction(text, requestId);
        }}
        onClose={onClose}
      />
    </Panel>
  );
}
