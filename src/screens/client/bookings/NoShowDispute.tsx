import { useState } from 'react';
import { ActionButton } from '../../../components/ActionButton';
import { Button } from '../../../components/Button';
import { InlinePanel } from '../../../components/InlinePanel';
import { TextArea } from '../../../components/TextArea';
import { DISPUTE_REASON_MAX, DISPUTE_REASON_MIN, disputeNoShow, type NoShowDispute } from '../../../data/noShows';
import { canRetryRpc, rpcErrorMessage } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import styles from './bookings.module.css';

/** Where a contested no-show stands (T53), in one line; the state is also said in words, never by color alone. */
export function NoShowDisputeStatus({ dispute }: { dispute: NoShowDispute }) {
  const { t } = useI18n();
  return (
    <p className={dispute.status === 'upheld' ? styles.ok : styles.muted} role="status">
      {t(`cb.dispute.${dispute.status}`)}
    </p>
  );
}

/** The client contests a no-show: what happened (10–1000 characters), sent once. */
export function NoShowDisputePanel({
  bookingId,
  onSent,
  onClose,
}: {
  bookingId: string;
  onSent: (dispute: NoShowDispute) => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [reason, setReason] = useState('');
  const length = reason.trim().length;
  return (
    <InlinePanel title={t('cb.dispute.title')}>
      <p className={styles.panelBody}>{t('cb.dispute.body')}</p>
      <TextArea
        label={t('cb.dispute.reason')}
        hint={t('cb.dispute.hint', { min: DISPUTE_REASON_MIN })}
        value={reason}
        maxLength={DISPUTE_REASON_MAX}
        rows={4}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className={styles.buttons}>
        <ActionButton
          block={false}
          disabled={length < DISPUTE_REASON_MIN}
          onAction={async (rid) => onSent(await disputeNoShow(bookingId, reason.trim(), rid))}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('cb.dispute.submit')}
        </ActionButton>
        <Button variant="ghost" onClick={onClose}>
          {t('cb.dispute.close')}
        </Button>
      </div>
    </InlinePanel>
  );
}
