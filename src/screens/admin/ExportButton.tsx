import { fetchExport, type ExportKind } from '../../data/adminTools';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { ymdInBucharest } from '../../i18n/format';
import { exportFileName, exportTable } from '../../lib/adminTools';
import { csvFormat, toCsv } from '../../lib/history';
import { saveFile } from '../../lib/report';
import { ActionButton } from '../../components/ActionButton';

/**
 * "Descarcă CSV" (FR §5.11): the rows of one list, with the filters the list shows (bookings and
 * reviews filtered by the database, the others by `narrow`), as a file in the interface language.
 * Every export is written to the audit log (it holds personal data).
 */
export function ExportButton<R>({
  kind,
  filters = {},
  narrow,
  label,
}: {
  kind: ExportKind;
  filters?: Record<string, unknown>;
  /** The screen's own filter, applied to the rows before writing the file. */
  narrow?: (rows: R[]) => R[];
  label?: string;
}) {
  const { t, lang } = useI18n();
  return (
    <ActionButton
      variant="secondary"
      block={false}
      onAction={async () => {
        const rows = (await fetchExport(kind, filters)) as R[];
        const table = exportTable(kind, narrow ? narrow(rows) : rows, t, lang);
        const blob = new Blob([toCsv(table, csvFormat(lang).separator)], { type: 'text/csv;charset=utf-8' });
        saveFile(blob, exportFileName(kind, t, ymdInBucharest(new Date())));
      }}
      errorMessage={(e) => rpcErrorMessage(lang, e)}
      canRetry={canRetryRpc}
    >
      {label ?? t('admin.export.download')}
    </ActionButton>
  );
}
