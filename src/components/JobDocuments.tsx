import { FileText } from 'lucide-react';
import { jobDocFileName } from '../../supabase/functions/_shared/jobDoc.ts';
import { downloadJobDocument, type JobDocKind } from '../data/jobDocs';
import { canRetryRpc, rpcErrorMessage } from '../data/rpc';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/ro';
import { saveFile } from '../lib/saveFile';
import { ActionButton } from './ActionButton';
import styles from './JobDocuments.module.css';

const LABEL: Record<JobDocKind, MessageKey> = {
  quote: 'doc.quote',
  intake: 'doc.intake',
  final: 'doc.final',
};

/**
 * The PDFs of a booking (T50) the reader may download: the quote, the intake sheet, the final
 * quote. The same documents for the shop and the client, in the reader's language.
 */
export function JobDocuments({
  bookingId,
  bookingRef,
  quoteNumber,
  kinds,
}: {
  bookingId: string;
  bookingRef: string;
  quoteNumber: number | null | undefined;
  kinds: JobDocKind[];
}) {
  const { t, lang } = useI18n();
  if (kinds.length === 0) return null;
  return (
    <div className={styles.docs} role="group" aria-label={t('doc.title')}>
      {kinds.map((kind) => (
        <ActionButton
          key={kind}
          variant="secondary"
          block={false}
          onAction={async () => {
            const blob = await downloadJobDocument(bookingId, kind, lang);
            await saveFile(blob, jobDocFileName(lang, { kind, booking: { ref: bookingRef, quote_number: quoteNumber ?? null } }));
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          <FileText size={16} aria-hidden="true" />
          {t(LABEL[kind])}
        </ActionButton>
      ))}
    </div>
  );
}
